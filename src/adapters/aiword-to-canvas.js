/**
 * Bidirectional format adapter between AIWord ai_view and canvas-editor elements.
 * Implements the spec from docs/adapter-spec.md.
 *
 * The actual ai_view format from the Python parser uses:
 *   - block.paragraph_format.alignment  (not block.alignment)
 *   - piece.overrides.{bold, italic, size, color, font_ascii}  (not direct on piece)
 *   - piece.type === 'Text'
 */

const ALIGNMENT_MAP = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'stretch',
}

const REVERSE_ALIGNMENT_MAP = {
  left: 'left',
  center: 'center',
  right: 'right',
  stretch: 'justify',
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

/**
 * Convert AIWord ai_view to canvas-editor element array.
 * @param {object} aiView  — ai_view JSON from the Python to_ai_view() function
 * @returns {{ main: object[], header: [], footer: [] }}
 */
export function aiwordToCanvas(aiView) {
  const elements = []
  const body = aiView?.document?.body ?? []

  for (const block of body) {
    if (block.type !== 'Paragraph') continue

    // Support both real format (paragraph_format.alignment) and simplified format (block.alignment)
    const alignment = block.paragraph_format?.alignment ?? block.alignment ?? 'left'
    const rowFlex = ALIGNMENT_MAP[alignment] ?? 'left'
    const styleDefaults = HEADING_STYLE_MAP[block.style] ?? HEADING_STYLE_MAP.Normal
    const defaultRun = block.default_run ?? {}

    for (const piece of block.content ?? []) {
      // Handle real format (type: 'Text', overrides) and simplified format (direct fields)
      if (piece.type !== undefined && piece.type !== 'Text') continue

      const overrides = piece.overrides ?? {}
      const el = { value: piece.text ?? '' }

      // bold: explicit override > default_run > style default
      const boldVal = overrides.bold ?? piece.bold
      const effectiveBold = boldVal !== undefined ? boldVal : (defaultRun.bold ?? styleDefaults.bold)
      if (effectiveBold) el.bold = true

      // italic
      const italicVal = overrides.italic ?? piece.italic
      if (italicVal) el.italic = true

      // size: half-points → pt
      const sizeVal = overrides.size ?? piece.size
      if (sizeVal !== undefined) {
        el.size = sizeVal / 2
      } else {
        const defaultSize = defaultRun.size ?? styleDefaults.size
        el.size = defaultSize / 2
      }

      // color
      const colorVal = overrides.color ?? piece.color
      if (colorVal) el.color = colorVal

      // font
      const fontVal = overrides.font_ascii ?? piece.font_ascii
      if (fontVal) el.font = fontVal

      el.rowFlex = rowFlex
      elements.push(el)
    }

    // Paragraph separator
    elements.push({ value: '\n', rowFlex })
  }

  return { main: elements, header: [], footer: [] }
}

/**
 * Convert canvas-editor elements back to AIWord ai_view format.
 * Preserves block ids from originalAiView where possible.
 * @param {{ main: object[] }} canvasData
 * @param {object} [originalAiView]
 * @returns {object}  — ai_view compatible with merge_ai_edits()
 */
export function canvasToAiword(canvasData, originalAiView) {
  const elements = canvasData?.main ?? []
  const originalBody = originalAiView?.document?.body ?? []
  const body = []
  let currentRuns = []
  let paraIndex = 0
  let currentRowFlex = 'left'
  let newParaCount = 0

  for (const el of elements) {
    // Skip non-text element types (images, tables, etc.)
    if (el.type && el.type !== 'TEXT' && el.value !== '\n') continue

    if (el.value === '\n') {
      const originalPara = originalBody[paraIndex]
      const id = originalPara?.id ?? (
        paraIndex < originalBody.length ? `b${paraIndex}` : `new_${newParaCount++}`
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

      const overrides = {}
      if (el.bold !== undefined) overrides.bold = !!el.bold
      if (el.italic !== undefined) overrides.italic = !!el.italic
      if (el.size !== undefined) overrides.size = el.size * 2  // pt → half-points
      if (el.color !== undefined) overrides.color = el.color
      if (el.font !== undefined) overrides.font_ascii = el.font

      const run = {
        type: 'Text',
        text: (el.value ?? '').replace(/\n/g, ' '),
      }
      if (Object.keys(overrides).length > 0) run.overrides = overrides
      currentRuns.push(run)
    }
  }

  // Handle document that doesn't end with \n
  if (currentRuns.length > 0) {
    const originalPara = originalBody[paraIndex]
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
      meta: originalAiView?.document?.meta ?? { page: { width: 12240, height: 15840 } },
      styles: originalAiView?.document?.styles ?? {},
      body,
    },
  }
}
