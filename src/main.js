import Editor from '@hufe921/canvas-editor'

// ─── DOM refs ───────────────────────────────────────────────────────────────
const progressContainer = document.getElementById('progress-container')
const progressBar        = document.getElementById('progress-bar')
const progressText       = document.getElementById('progress-text')

const btnImport   = document.getElementById('btn-import')
const btnUpdateAI = document.getElementById('btn-update-ai')
const btnCompile  = document.getElementById('btn-compile')
const btnExport   = document.getElementById('btn-export')
const btnApiKey   = document.getElementById('btn-apikey')
const btnSend     = document.getElementById('btn-send')
const chatInput   = document.getElementById('chat-input')
const fileInput   = document.getElementById('file-input')

const modalApiKey   = document.getElementById('modal-apikey')
const btnSaveApiKey = document.getElementById('btn-save-apikey')
const btnCloseModal = document.getElementById('btn-close-modal')
const selectProvider = document.getElementById('select-provider')
const labelBaseUrl   = document.getElementById('label-baseurl')
const chatMessages   = document.getElementById('chat-messages')

// ─── Progress helpers ────────────────────────────────────────────────────────
function setProgress(percent, text = '') {
  progressBar.style.width = `${percent}%`
  if (text) progressText.textContent = text
}

function hideProgress() {
  progressContainer.classList.add('done')
}

// ─── Enable all toolbar buttons ──────────────────────────────────────────────
function enableToolbar() {
  btnImport.disabled   = false
  btnUpdateAI.disabled = false
  btnCompile.disabled  = false
  btnExport.disabled   = false
  btnApiKey.disabled   = false
  btnSend.disabled     = false
  chatInput.disabled   = false
}

// ─── Chat helpers ────────────────────────────────────────────────────────────
function appendMessage(role, text) {
  const bubble = document.createElement('div')
  bubble.className = `chat-bubble ${role}`
  bubble.textContent = text
  chatMessages.appendChild(bubble)
  chatMessages.scrollTop = chatMessages.scrollHeight
}

// ─── canvas-editor 初始化 ────────────────────────────────────────────────────
const container = document.getElementById('canvas-container')
const editor = new Editor(
  container,
  { main: [], header: [] },          // 初始空文档
  {
    pageMode: 'paging',              // A4 分页模式
    width: 794,
    height: 1123,
    margins: [100, 120, 100, 120],   // 上右下左 (px)
    zone: {
      tipDisabled: false
    }
  }
)

// ─── API Key 模态框 ───────────────────────────────────────────────────────────
btnApiKey.addEventListener('click', () => {
  modalApiKey.classList.remove('hidden')
})
btnCloseModal.addEventListener('click', () => {
  modalApiKey.classList.add('hidden')
})
modalApiKey.addEventListener('click', (e) => {
  if (e.target === modalApiKey) modalApiKey.classList.add('hidden')
})
selectProvider.addEventListener('change', () => {
  labelBaseUrl.classList.toggle('hidden', selectProvider.value !== 'custom')
})
btnSaveApiKey.addEventListener('click', () => {
  const key      = document.getElementById('input-apikey').value.trim()
  const provider = selectProvider.value
  const model    = document.getElementById('input-model').value.trim()
  const baseUrl  = document.getElementById('input-baseurl').value.trim()
  if (key) {
    localStorage.setItem('waw_apikey',   key)
    localStorage.setItem('waw_provider', provider)
    localStorage.setItem('waw_model',    model || 'gpt-4o')
    if (provider === 'custom' && baseUrl) {
      localStorage.setItem('waw_baseurl', baseUrl)
    }
    modalApiKey.classList.add('hidden')
    appendMessage('system', `✅ API Key 已保存（Provider: ${provider}）`)
  } else {
    alert('请输入有效的 API Key')
  }
})

// ─── 文件导入骨架（后续 Step 2 完善）────────────────────────────────────────
btnImport.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  fileInput.value = ''
  appendMessage('system', `📂 已选择文件：${file.name}（Pyodide 解析将在 Step 2 实现）`)
})

// ─── 其他按钮占位（后续步骤实现）────────────────────────────────────────────
btnUpdateAI.addEventListener('click', () => {
  appendMessage('system', '📋 更新到 AI（适配层将在 Step 3 实现）')
})
btnCompile.addEventListener('click', () => {
  appendMessage('system', '🔨 编译到文档（适配层将在 Step 3 实现）')
})
btnExport.addEventListener('click', () => {
  appendMessage('system', '💾 导出 .docx（Pyodide 渲染将在 Step 2 实现）')
})

// ─── 发送消息占位 ─────────────────────────────────────────────────────────────
btnSend.addEventListener('click', sendMessage)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})
function sendMessage() {
  const text = chatInput.value.trim()
  if (!text) return
  chatInput.value = ''
  appendMessage('user', text)
  appendMessage('system', '⚙️ AI 服务将在 Step 4 实现')
}

// ─── 模拟 Pyodide 加载（Step 2 替换为真实 Worker）────────────────────────────
async function simulatePyodideLoading() {
  setProgress(10, '正在加载 Pyodide 运行时...')
  await new Promise(r => setTimeout(r, 600))
  setProgress(40, '正在安装 Python 依赖（python-docx, lxml）...')
  await new Promise(r => setTimeout(r, 600))
  setProgress(75, '正在加载 AIWord 核心模块...')
  await new Promise(r => setTimeout(r, 500))
  setProgress(100, 'Pyodide 就绪')
  await new Promise(r => setTimeout(r, 300))
  hideProgress()
  enableToolbar()
  appendMessage('system', '✅ Pyodide 运行时就绪（当前为模拟模式，Step 2 将接入真实 Worker）')
}

simulatePyodideLoading()
