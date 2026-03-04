function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function parsePointer(path) {
  if (path === '') return []
  if (!path.startsWith('/')) {
    throw new Error(`JSON Pointer 非法，必须以 / 开头: ${path}`)
  }
  return path.slice(1).split('/').map(decodePointerToken)
}

function getContainerAndKey(root, pointerTokens) {
  if (pointerTokens.length === 0) {
    return { container: null, key: null }
  }

  let node = root
  for (let i = 0; i < pointerTokens.length - 1; i++) {
    const token = pointerTokens[i]
    if (Array.isArray(node)) {
      const idx = Number(token)
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) {
        throw new Error(`数组路径不存在: /${pointerTokens.slice(0, i + 1).join('/')}`)
      }
      node = node[idx]
    } else if (node && typeof node === 'object') {
      if (!(token in node)) {
        throw new Error(`对象路径不存在: /${pointerTokens.slice(0, i + 1).join('/')}`)
      }
      node = node[token]
    } else {
      throw new Error(`路径不是对象/数组: /${pointerTokens.slice(0, i + 1).join('/')}`)
    }
  }

  return { container: node, key: pointerTokens[pointerTokens.length - 1] }
}

function setByPointer(root, path, value, mode = 'replace') {
  const tokens = parsePointer(path)
  if (tokens.length === 0) {
    throw new Error('不支持直接替换根对象')
  }

  const { container, key } = getContainerAndKey(root, tokens)
  if (Array.isArray(container)) {
    if (mode === 'add' && key === '-') {
      container.push(value)
      return
    }
    const idx = Number(key)
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`数组索引非法: ${key}`)
    }

    if (mode === 'add') {
      if (idx > container.length) throw new Error(`数组插入越界: ${idx}`)
      container.splice(idx, 0, value)
      return
    }

    if (idx >= container.length) throw new Error(`数组替换越界: ${idx}`)
    container[idx] = value
    return
  }

  if (!container || typeof container !== 'object') {
    throw new Error(`目标容器不是对象: ${path}`)
  }

  if (mode === 'replace' && !(key in container)) {
    throw new Error(`对象字段不存在，无法 replace: ${path}`)
  }
  container[key] = value
}

function removeByPointer(root, path) {
  const tokens = parsePointer(path)
  if (tokens.length === 0) {
    throw new Error('不支持删除根对象')
  }
  const { container, key } = getContainerAndKey(root, tokens)

  if (Array.isArray(container)) {
    const idx = Number(key)
    if (!Number.isInteger(idx) || idx < 0 || idx >= container.length) {
      throw new Error(`数组删除越界: ${path}`)
    }
    container.splice(idx, 1)
    return
  }

  if (!container || typeof container !== 'object') {
    throw new Error(`目标容器不是对象: ${path}`)
  }
  if (!(key in container)) {
    throw new Error(`对象字段不存在，无法 remove: ${path}`)
  }
  delete container[key]
}

function findBlockIndexById(doc, blockId) {
  const body = doc?.document?.body
  if (!Array.isArray(body)) {
    throw new Error('当前文档缺少 document.body 数组')
  }
  return body.findIndex(block => block?.id === blockId)
}

function mergeObject(target, partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new Error('update_by_id 的 fields 必须是对象')
  }
  for (const [k, v] of Object.entries(partial)) {
    target[k] = v
  }
}

export class AIPatchService {
  isPatchEnvelope(obj) {
    return !!obj && typeof obj === 'object' && obj.protocol === 'aiword.patch.v1' && Array.isArray(obj.operations)
  }

  isAiView(obj) {
    return !!obj && typeof obj === 'object' && !!obj.document && Array.isArray(obj.document.body)
  }

  applyPatch(baseAiView, patchEnvelope) {
    if (!this.isPatchEnvelope(patchEnvelope)) {
      throw new Error('不是 aiword.patch.v1 协议格式')
    }

    const next = deepClone(baseAiView)
    const body = next?.document?.body
    if (!Array.isArray(body)) {
      throw new Error('当前文档结构不合法：缺少 document.body')
    }

    for (const opItem of patchEnvelope.operations) {
      const op = opItem?.op
      if (!op) throw new Error('patch 操作缺少 op 字段')

      if (op === 'add' || op === 'replace') {
        setByPointer(next, opItem.path, opItem.value, op)
      } else if (op === 'remove') {
        removeByPointer(next, opItem.path)
      } else if (op === 'insert_after_id' || op === 'insert_before_id') {
        const idx = findBlockIndexById(next, opItem.target_id)
        if (idx < 0) throw new Error(`未找到目标段落 id: ${opItem.target_id}`)
        const insertIdx = op === 'insert_after_id' ? idx + 1 : idx
        body.splice(insertIdx, 0, opItem.value)
      } else if (op === 'replace_by_id') {
        const idx = findBlockIndexById(next, opItem.target_id)
        if (idx < 0) throw new Error(`未找到目标段落 id: ${opItem.target_id}`)
        body[idx] = opItem.value
      } else if (op === 'update_by_id') {
        const idx = findBlockIndexById(next, opItem.target_id)
        if (idx < 0) throw new Error(`未找到目标段落 id: ${opItem.target_id}`)
        mergeObject(body[idx], opItem.fields)
      } else {
        throw new Error(`不支持的 patch op: ${op}`)
      }
    }

    return next
  }
}
