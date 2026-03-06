function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

function normalizeColor(value) {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  const hex = raw.startsWith('#') ? raw.slice(1) : raw
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`
  return undefined
}

function normalizeRun(rawRun) {
  const run = rawRun && typeof rawRun === 'object' ? rawRun : {}
  const text = typeof run.text === 'string'
    ? run.text
    : (typeof run.value === 'string' ? run.value : '')

  const legacySource = run.overrides && typeof run.overrides === 'object' ? run.overrides : run
  const overrides = {}

  if (legacySource.bold !== undefined) overrides.bold = !!legacySource.bold
  if (legacySource.italic !== undefined) overrides.italic = !!legacySource.italic
  if (typeof legacySource.size === 'number' && Number.isFinite(legacySource.size)) overrides.size = legacySource.size
  if (typeof legacySource.font_ascii === 'string' && legacySource.font_ascii.trim()) overrides.font_ascii = legacySource.font_ascii.trim()
  if (typeof legacySource.font_east_asia === 'string' && legacySource.font_east_asia.trim()) overrides.font_east_asia = legacySource.font_east_asia.trim()

  const color = normalizeColor(legacySource.color)
  if (color) overrides.color = color

  const normalized = { type: 'Text', text }
  if (Object.keys(overrides).length > 0) normalized.overrides = overrides
  return normalized
}

function normalizeParagraph(rawBlock, index) {
  const block = rawBlock && typeof rawBlock === 'object' ? rawBlock : {}
  const id = typeof block.id === 'string' && block.id.trim() ? block.id : `b${index}`
  const style = typeof block.style === 'string' && block.style.trim() ? block.style : 'Normal'

  const rawAlignment = block?.paragraph_format?.alignment ?? block.alignment ?? 'left'
  const alignment = ['left', 'center', 'right', 'justify'].includes(rawAlignment) ? rawAlignment : 'left'

  const runList = Array.isArray(block.content)
    ? block.content
    : (Array.isArray(block.runs)
      ? block.runs
      : (typeof block.text === 'string' ? [block.text] : []))

  const content = runList.map((rawRun) => {
    if (typeof rawRun === 'string') return normalizeRun({ type: 'Text', text: rawRun })
    return normalizeRun(rawRun)
  })

  const normalized = {
    type: 'Paragraph',
    id,
    style,
    content,
    paragraph_format: {
      alignment,
    },
  }

  if (block.default_run && typeof block.default_run === 'object') {
    normalized.default_run = deepClone(block.default_run)
  }

  return normalized
}

function normalizeBody(rawBody) {
  const body = Array.isArray(rawBody) ? rawBody : []
  const normalized = []
  let paraIndex = 0

  for (const item of body) {
    const blockType = typeof item?.type === 'string' ? item.type.toLowerCase() : ''
    if (blockType && blockType !== 'paragraph') {
      normalized.push(deepClone(item))
      continue
    }
    normalized.push(normalizeParagraph(item, paraIndex))
    paraIndex++
  }

  return normalized
}

export function normalizeAiView(aiView) {
  const meta = aiView?.document?.meta && typeof aiView.document.meta === 'object'
    ? deepClone(aiView.document.meta)
    : { page: { width: 12240, height: 15840 } }

  const styles = aiView?.document?.styles && typeof aiView.document.styles === 'object'
    ? deepClone(aiView.document.styles)
    : {}

  return {
    document: {
      meta,
      styles,
      body: normalizeBody(aiView?.document?.body),
    },
  }
}

export function mergeParagraphsIntoAiView(baseAiView, paragraphBlocks) {
  const base = normalizeAiView(baseAiView)
  const nextParas = Array.isArray(paragraphBlocks) ? paragraphBlocks.map((p, i) => normalizeParagraph(p, i)) : []

  const newBody = []
  let paraCursor = 0
  for (const block of base.document.body) {
    const type = typeof block?.type === 'string' ? block.type.toLowerCase() : ''
    if (type === 'paragraph' || !type) {
      if (paraCursor < nextParas.length) {
        newBody.push(nextParas[paraCursor++])
      }
    } else {
      newBody.push(deepClone(block))
    }
  }

  while (paraCursor < nextParas.length) {
    newBody.push(nextParas[paraCursor++])
  }

  return {
    document: {
      ...base.document,
      body: newBody,
    },
  }
}

export function extractParagraphBlocks(aiView) {
  const normalized = normalizeAiView(aiView)
  return normalized.document.body.filter((block) => {
    const type = typeof block?.type === 'string' ? block.type.toLowerCase() : ''
    return !type || type === 'paragraph'
  })
}
