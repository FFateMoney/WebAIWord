/**
 * AIService — calls OpenAI or Claude AI APIs with SSE streaming.
 * API keys are stored in localStorage only.
 */
export class AIService {
  /**
   * Read AI config from localStorage.
   * @returns {{ provider: string, apiKey: string, baseUrl: string, model: string }}
   */
  getConfig() {
    return {
      provider: localStorage.getItem('waw_provider') || 'openai',
      apiKey: localStorage.getItem('waw_apikey') || '',
      baseUrl: localStorage.getItem('waw_baseurl') || '',
      model: localStorage.getItem('waw_model') || 'gpt-4o',
    }
  }

  /**
   * Save AI config to localStorage.
   * @param {{ provider: string, apiKey: string, baseUrl?: string, model: string }} config
   */
  saveConfig(config) {
    localStorage.setItem('waw_provider', config.provider || 'openai')
    localStorage.setItem('waw_apikey', config.apiKey || '')
    localStorage.setItem('waw_model', config.model || 'gpt-4o')
    if (config.baseUrl) {
      localStorage.setItem('waw_baseurl', config.baseUrl)
    }
  }

  /**
   * Stream chat messages from AI API.
   * Yields each token string as it arrives.
   * @param {Array<{role: string, content: string}>} messages
   * @returns {AsyncGenerator<string>}
   */
  async *streamChat(messages) {
    const { provider, apiKey, baseUrl, model } = this.getConfig()
    if (!apiKey) throw new Error('未配置 API Key，请点击「⚙️ API Key」按钮进行配置')

    if (provider === 'claude') {
      yield* this._streamClaude(messages, apiKey, model)
    } else {
      // openai or custom
      const url = provider === 'custom' && baseUrl
        ? baseUrl.replace(/\/$/, '') + '/chat/completions'
        : 'https://api.openai.com/v1/chat/completions'
      yield* this._streamOpenAI(messages, apiKey, model, url)
    }
  }

  async *_streamOpenAI(messages, apiKey, model, url) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`OpenAI API error ${resp.status}: ${errText}`)
    }

    yield* this._readSSE(resp.body, (data) => {
      if (data === '[DONE]') return null
      try {
        const obj = JSON.parse(data)
        return obj.choices?.[0]?.delta?.content ?? null
      } catch {
        return null
      }
    })
  }

  async *_streamClaude(messages, apiKey, model) {
    // Separate system messages from user/assistant messages
    const systemMsgs = messages.filter(m => m.role === 'system')
    const chatMsgs = messages.filter(m => m.role !== 'system')
    const systemText = systemMsgs.map(m => m.content).join('\n\n')

    const body = {
      model,
      max_tokens: 4096,
      messages: chatMsgs,
      stream: true,
    }
    if (systemText) body.system = systemText

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`Claude API error ${resp.status}: ${errText}`)
    }

    yield* this._readSSE(resp.body, (data) => {
      try {
        const obj = JSON.parse(data)
        if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
          return obj.delta.text ?? null
        }
        return null
      } catch {
        return null
      }
    })
  }

  /**
   * Read an SSE stream and yield tokens via a parser function.
   * @param {ReadableStream} body
   * @param {function(string): string|null} parseData
   */
  async *_readSSE(body, parseData) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data) continue
        const token = parseData(data)
        if (token) yield token
      }
    }

    // Flush remaining buffer
    if (buffer.startsWith('data:')) {
      const data = buffer.slice(5).trim()
      if (data) {
        const token = parseData(data)
        if (token) yield token
      }
    }
  }

  /**
   * Extract the first complete JSON object or array from a string.
   * @param {string} text
   * @returns {object|array|null}
   */
  extractJSON(text) {
    // Try to find a JSON code block first
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim())
      } catch { /* fall through */ }
    }

    // Find first { or [
    let start = -1
    let startChar = ''
    let endChar = ''
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') { start = i; startChar = '{'; endChar = '}'; break }
      if (text[i] === '[') { start = i; startChar = '['; endChar = ']'; break }
    }
    if (start === -1) return null

    // Find matching end by counting depth
    let depth = 0
    let inStr = false
    let escape = false
    for (let i = start; i < text.length; i++) {
      const c = text[i]
      if (escape) { escape = false; continue }
      if (c === '\\' && inStr) { escape = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === startChar) depth++
      else if (c === endChar) {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1))
          } catch {
            return null
          }
        }
      }
    }
    return null
  }
}
