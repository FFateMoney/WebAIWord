/**
 * Bidirectional format adapter between canonical AIView and canvas-editor elements.
 * Canonical rules:
 * - Paragraph alignment: block.paragraph_format.alignment
 * - Text styling: piece.overrides.{bold, italic, size, color, font_ascii, font_east_asia}
 * - Text run: piece.type === 'Text'
 */

const ALIGNMENT_MAP = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
}

const REVERSE_ALIGNMENT_MAP = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
}

// Default size/bold for known heading styles (size in half-points)
const HEADING_STYLE_MAP = {
  Heading1: { size: 32, bold: true },
  Heading2: { size: 28, bold: true },
  Heading3: { size: 24, bold: true },
  Heading4: { size: 20, bold: true },
  Heading5: { size: 18, bold: true },
  Heading6: { size: 16, bold: true },
  Title: { size: 36, bold: true },
  Subtitle: { size: 24, bold: false },
  Normal: { size: 16, bold: false },
}

const TABLE_TOKEN_RE = /^\[AIWORD_TABLE:([^\]]+)\]$/
const IMAGE_TOKEN_RE = /^\[AIWORD_IMAGE:([^:]+):(\d+)\]$/

function createImageLookup(body) {
  const map = new Map()
  for (const block of body) {
    const blockType = typeof block?.type === 'string' ? block.type.toLowerCase() : ''
    if (blockType && blockType !== 'paragraph') continue
    const paraId = typeof block?.id === 'string' ? block.id : ''
    if (!paraId) continue
    const runList = Array.isArray(block?.content) ? block.content : []
    let imageIndex = 0
    for (const piece of runList) {
      const pieceType = typeof piece?.type === 'string' ? piece.type.toLowerCase() : ''
      if (pieceType === 'inlineimage') {
        map.set(`${paraId}:${imageIndex}`, JSON.parse(JSON.stringify(piece)))
        imageIndex += 1
      }
    }
  }
  return map
}

/**
 * Convert canonical AIView paragraphs to canvas-editor element array.
 * @param {object} aiView
 * @returns {{ main: object[], header: [], footer: [] }}
 */
export function aiwordToCanvas(aiView) {
  const elements = []
  const body = aiView?.document?.body ?? []

  for (const block of body) {
    const blockType = typeof block?.type === 'string' ? block.type.toLowerCase() : ''
    if (blockType === 'table') {
      elements.push({
        value: `[AIWORD_TABLE:${block?.id ?? ''}]`,
        color: '#6B7280',
        italic: true,
        rowFlex: 'left',
      })
      elements.push({ value: '\n', rowFlex: 'left' })
      continue
    }
    if (blockType && blockType !== 'paragraph') continue

    const alignment = block?.paragraph_format?.alignment ?? 'left'
    const rowFlex = ALIGNMENT_MAP[alignment] ?? 'left'
    const styleDefaults = HEADING_STYLE_MAP[block?.style] ?? HEADING_STYLE_MAP.Normal
    const defaultRun = block?.default_run && typeof block.default_run === 'object' ? block.default_run : {}
    const runList = Array.isArray(block?.content) ? block.content : []

    let imageIndex = 0
    for (const piece of runList) {
      const pieceType = typeof piece?.type === 'string' ? piece.type.toLowerCase() : ''
      if (pieceType === 'inlineimage') {
        elements.push({
          value: `[AIWORD_IMAGE:${block?.id ?? ''}:${imageIndex}]`,
          color: '#6B7280',
          italic: true,
          rowFlex,
        })
        imageIndex += 1
        continue
      }
      if (pieceType && pieceType !== 'text') continue

      const overrides = piece?.overrides && typeof piece.overrides === 'object' ? piece.overrides : {}
      const el = { value: piece?.text ?? '' }

      const boldVal = overrides.bold
      const effectiveBold = boldVal !== undefined ? boldVal : (defaultRun.bold ?? styleDefaults.bold)
      if (effectiveBold) el.bold = true

      const italicVal = overrides.italic ?? defaultRun.italic
      if (italicVal) el.italic = true

      const sizeVal = overrides.size
      if (sizeVal !== undefined) {
        el.size = sizeVal / 2
      } else {
        const defaultSize = defaultRun.size ?? styleDefaults.size
        el.size = defaultSize / 2
      }

      const colorVal = overrides.color ?? defaultRun.color
      if (colorVal && typeof colorVal === 'string') {
        el.color = colorVal.startsWith('#') ? colorVal : `#${colorVal}`
      }

      const fontVal = overrides.font_east_asia ?? overrides.font_ascii ?? defaultRun.font_east_asia ?? defaultRun.font_ascii
      if (fontVal) el.font = fontVal

      el.rowFlex = rowFlex
      elements.push(el)
    }

    elements.push({ value: '\n', rowFlex })
  }

  return { main: elements, header: [], footer: [] }
}

/**
 * Convert canvas-editor elements back to canonical AIView paragraph blocks.
 * @param {{ main: object[] }} canvasData
 * @param {object} [originalParagraphAiView]
 * @returns {object}
 */
export function canvasToAiword(canvasData, originalParagraphAiView) {
  const elements = canvasData?.main ?? []
  const originalBody = originalParagraphAiView?.document?.body ?? []
  const originalParagraphs = originalBody.filter((block) => {
    const type = typeof block?.type === 'string' ? block.type.toLowerCase() : ''
    return !type || type === 'paragraph'
  })
  const originalTableById = new Map(
    originalBody
      .filter((block) => (typeof block?.type === 'string' ? block.type.toLowerCase() : '') === 'table' && typeof block?.id === 'string')
      .map((block) => [block.id, JSON.parse(JSON.stringify(block))])
  )
  const imageLookup = createImageLookup(originalBody)
  const body = []
  let currentRuns = []
  let paraIndex = 0
  let currentRowFlex = 'left'
  let newParaCount = 0

  for (const el of elements) {
    if (el.value === '\n') {
      if (
        currentRuns.length === 1
        && currentRuns[0]?.type === 'Text'
        && typeof currentRuns[0]?.text === 'string'
      ) {
        const tableToken = currentRuns[0].text.match(TABLE_TOKEN_RE)
        if (tableToken) {
          const tableId = tableToken[1]
          const originalTable = originalTableById.get(tableId)
          if (originalTable) {
            body.push(originalTable)
            currentRuns = []
            currentRowFlex = 'left'
            continue
          }
        }
      }

      const originalPara = originalParagraphs[paraIndex]
      const id = originalPara?.id ?? (
        paraIndex < originalParagraphs.length ? `b${paraIndex}` : `new_${newParaCount++}`
      )
      const alignment = REVERSE_ALIGNMENT_MAP[el.rowFlex ?? currentRowFlex] ?? 'left'

      body.push({
        type: 'Paragraph',
        id,
        style: originalPara?.style ?? 'Normal',
        content: currentRuns,
        paragraph_format: { alignment },
      })

      currentRuns = []
      paraIndex++
      currentRowFlex = 'left'
    } else {
      if (el.rowFlex) currentRowFlex = el.rowFlex

      const text = (el.value ?? '').replace(/\n/g, ' ')
      const originalPara = originalParagraphs[paraIndex]
      const imageToken = text.match(IMAGE_TOKEN_RE)
      if (imageToken && originalPara?.id) {
        const imagePiece = imageLookup.get(`${originalPara.id}:${Number(imageToken[2])}`)
        if (imagePiece) {
          currentRuns.push(imagePiece)
          continue
        }
      }

      const overrides = {}
      if (el.bold !== undefined) overrides.bold = !!el.bold
      if (el.italic !== undefined) overrides.italic = !!el.italic
      if (el.size !== undefined) overrides.size = el.size * 2
      if (el.color !== undefined) overrides.color = el.color
      if (el.font !== undefined) {
        overrides.font_ascii = el.font
        overrides.font_east_asia = el.font
      }

      const run = {
        type: 'Text',
        text,
      }
      if (Object.keys(overrides).length > 0) run.overrides = overrides
      currentRuns.push(run)
    }
  }

  if (currentRuns.length > 0) {
    const originalPara = originalParagraphs[paraIndex]
    body.push({
      type: 'Paragraph',
      id: originalPara?.id ?? `b${paraIndex}`,
      style: originalPara?.style ?? 'Normal',
      content: currentRuns,
      paragraph_format: { alignment: REVERSE_ALIGNMENT_MAP[currentRowFlex] ?? 'left' },
    })
  }

  return {
    document: {
      meta: originalParagraphAiView?.document?.meta ?? { page: { width: 12240, height: 15840 } },
      styles: originalParagraphAiView?.document?.styles ?? {},
      body,
    },
  }
}
