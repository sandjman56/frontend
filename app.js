// Configuration (adjust to match your backend environment)
const API_BASE = 'http://localhost:8000';
const AUTH_TOKEN = 'dev-token'; // developer sets this to match backend
const POLL_MS_UPLOAD = 1500;
const POLL_MS_ANALYSIS = 2000;
const MAX_UPLOAD_MB = 20;

let authToken = AUTH_TOKEN; // session token that can be updated after 401s
let selectedFile = null;
let currentUpload = null;
let currentAnalysisId = null;
let latestAnalysisResult = null;
let uploadPollTimer = null;
let analysisPollTimer = null;

const elements = {
  dropZone: document.getElementById('dropZone'),
  fileInput: document.getElementById('fileInput'),
  fileError: document.getElementById('fileError'),
  fileDetails: document.getElementById('fileDetails'),
  fileName: document.getElementById('fileName'),
  fileSize: document.getElementById('fileSize'),
  uploadBtn: document.getElementById('uploadBtn'),
  progressWrapper: document.getElementById('uploadProgress'),
  progressBar: document.getElementById('progressBar'),
  uploadInfo: document.getElementById('uploadInfo'),
  metaFilename: document.getElementById('metaFilename'),
  metaPages: document.getElementById('metaPages'),
  metaSize: document.getElementById('metaSize'),
  metaStatus: document.getElementById('metaStatus'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  analysisStatus: document.getElementById('analysisStatus'),
  systemPrompt: document.getElementById('systemPrompt'),
  resultsSection: document.getElementById('resultsSection'),
  documentSummary: document.getElementById('documentSummary'),
  issuesContainer: document.getElementById('issuesContainer'),
  copyJsonBtn: document.getElementById('copyJsonBtn'),
  downloadJsonBtn: document.getElementById('downloadJsonBtn'),
  actionsRow: document.getElementById('actionsRow'),
  downloadPdfBtn: document.getElementById('downloadPdfBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  toastContainer: document.getElementById('toastContainer'),
  maxSizeLabel: document.getElementById('maxSizeLabel'),
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialise);
} else {
  initialise();
}

function initialise() {
  elements.maxSizeLabel.textContent = `${MAX_UPLOAD_MB} MB`;

  elements.dropZone.addEventListener('click', () => elements.fileInput.click());
  elements.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      elements.fileInput.click();
    }
  });
  elements.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragover');
  });
  elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('dragover');
  });
  elements.dropZone.addEventListener('drop', handleFileDrop);
  elements.fileInput.addEventListener('change', handleFileSelect);
  elements.uploadBtn.addEventListener('click', () => {
    if (selectedFile) {
      uploadSelectedFile();
    }
  });
  elements.analyzeBtn.addEventListener('click', beginAnalysis);
  elements.copyJsonBtn.addEventListener('click', copyAnalysisJson);
  elements.downloadJsonBtn.addEventListener('click', downloadAnalysisJson);
  elements.downloadPdfBtn.addEventListener('click', downloadOriginalPdf);
  elements.deleteBtn.addEventListener('click', deleteCurrentUpload);
}

function handleFileDrop(event) {
  event.preventDefault();
  elements.dropZone.classList.remove('dragover');
  const files = event.dataTransfer?.files;
  if (!files || !files.length) {
    return;
  }
  validateAndSetFile(files[0]);
}

function handleFileSelect(event) {
  const files = event.target.files;
  if (!files || !files.length) {
    return;
  }
  validateAndSetFile(files[0]);
  event.target.value = '';
}

function validateAndSetFile(file) {
  if (!file) {
    return;
  }
  const sizeMb = file.size / (1024 * 1024);
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (!isPdf) {
    showInlineError('Only PDF files are supported.');
    clearSelectedFile();
    return;
  }

  if (sizeMb > MAX_UPLOAD_MB) {
    showInlineError(`File is too large. Maximum size is ${MAX_UPLOAD_MB} MB.`);
    clearSelectedFile();
    return;
  }

  selectedFile = file;
  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = formatBytes(file.size);
  elements.fileDetails.classList.add('active');
  elements.uploadBtn.disabled = false;
  hideInlineError();
}

function clearSelectedFile() {
  selectedFile = null;
  elements.fileName.textContent = 'No file selected';
  elements.fileSize.textContent = '';
  elements.fileDetails.classList.remove('active');
  elements.uploadBtn.disabled = true;
}

function showInlineError(message) {
  elements.fileError.textContent = message;
  elements.fileError.setAttribute('aria-hidden', 'false');
}

function hideInlineError() {
  elements.fileError.textContent = '';
  elements.fileError.setAttribute('aria-hidden', 'true');
}

function uploadSelectedFile() {
  if (!selectedFile) {
    return;
  }

  clearInterval(uploadPollTimer);
  clearInterval(analysisPollTimer);
  analysisPollTimer = null;
  currentAnalysisId = null;
  latestAnalysisResult = null;

  elements.uploadBtn.disabled = true;
  elements.analyzeBtn.disabled = true;
  elements.analyzeBtn.textContent = 'Run Issue Spotter';
  elements.progressWrapper.classList.add('active');
  elements.progressWrapper.setAttribute('aria-hidden', 'false');
  elements.progressWrapper.setAttribute('aria-valuenow', '0');
  elements.progressBar.style.width = '0%';
  elements.resultsSection.hidden = true;
  elements.resultsSection.classList.remove('active');
  elements.actionsRow.hidden = true;
  elements.downloadPdfBtn.disabled = true;
  elements.deleteBtn.disabled = true;
  elements.issuesContainer.innerHTML = '';
  elements.documentSummary.textContent = '—';
  elements.analysisStatus.textContent = '';

  const formData = new FormData();
  formData.append('file', selectedFile);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE}/api/uploads`);
  xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) {
      animateIndeterminateProgress();
      return;
    }
    const percent = Math.round((event.loaded / event.total) * 100);
    elements.progressBar.style.width = `${percent}%`;
    elements.progressWrapper.setAttribute('aria-valuenow', String(percent));
  };

  xhr.onerror = () => {
    elements.progressWrapper.classList.remove('active');
    elements.progressWrapper.setAttribute('aria-hidden', 'true');
    showToast('Upload failed. Please check your connection and try again.', 'error');
    elements.uploadBtn.disabled = false;
  };

  xhr.onload = async () => {
    elements.progressWrapper.classList.remove('active');
    elements.progressWrapper.setAttribute('aria-hidden', 'true');
    elements.progressBar.style.width = '0%';

    if (xhr.status === 401) {
      await handleUnauthorized();
      elements.uploadBtn.disabled = false;
      return;
    }

    if (xhr.status < 200 || xhr.status >= 300) {
      const message = parseXhrError(xhr) || 'Upload failed.';
      showToast(message, 'error');
      elements.uploadBtn.disabled = false;
      return;
    }

    try {
      const response = JSON.parse(xhr.responseText);
      currentUpload = response;
      latestAnalysisResult = null;
      updateUploadMeta({ ...response, filename: response.filename || selectedFile.name, size_bytes: response.size_bytes ?? selectedFile.size });
      showToast('Upload complete. Extracting document…', 'success');
      startUploadPolling(response.upload_id);
      elements.actionsRow.hidden = false;
      elements.downloadPdfBtn.disabled = false;
      elements.deleteBtn.disabled = false;
    } catch (error) {
      showToast('Unexpected response from server.', 'error');
      elements.uploadBtn.disabled = false;
    }
  };

  xhr.send(formData);
}

function animateIndeterminateProgress() {
  elements.progressBar.style.transition = 'none';
  elements.progressBar.style.width = '30%';
  requestAnimationFrame(() => {
    elements.progressBar.style.transition = 'width 0.6s ease';
    elements.progressBar.style.width = '80%';
  });
}

function startUploadPolling(uploadId) {
  if (!uploadId) return;

  async function poll() {
    try {
      const data = await apiFetch(`/api/uploads/${uploadId}/status`);
      currentUpload = { ...currentUpload, ...data };
      updateUploadMeta(currentUpload);

      if (data.status === 'ready') {
        clearInterval(uploadPollTimer);
        uploadPollTimer = null;
        elements.analyzeBtn.disabled = false;
        showToast('Document is ready for analysis.', 'success');
      } else if (data.status === 'ready_for_analysis') {
        clearInterval(uploadPollTimer);
        uploadPollTimer = null;
        elements.analyzeBtn.disabled = false;
        updateStatusBadge('ready');
        showToast('Document is ready for analysis.', 'success');
      } else if (data.status === 'error') {
        clearInterval(uploadPollTimer);
        uploadPollTimer = null;
        elements.analyzeBtn.disabled = true;
        showToast('Extraction failed. Please try another document.', 'error');
      }
    } catch (error) {
      showToast(error.message || 'Unable to fetch upload status.', 'error');
    }
  }

  poll();
  uploadPollTimer = setInterval(poll, POLL_MS_UPLOAD);
}

function updateUploadMeta(upload) {
  if (!upload) return;
  elements.uploadInfo.hidden = false;
  elements.metaFilename.textContent = upload.filename || '—';
  if (typeof upload.pages === 'number') {
    elements.metaPages.textContent = String(upload.pages);
  } else if (upload.page_count) {
    elements.metaPages.textContent = String(upload.page_count);
  }
  if (typeof upload.size_bytes === 'number') {
    elements.metaSize.textContent = formatBytes(upload.size_bytes);
  }
  updateStatusBadge(upload.status || 'uploaded');
}

function updateStatusBadge(status) {
  const badge = elements.metaStatus;
  const readable = formatStatusLabel(status);
  const normalized = normalizeStatusValue(status);
  badge.textContent = readable;
  badge.className = `status-badge${normalized ? ` status-${normalized}` : ''}`;
}

function formatStatusLabel(status) {
  if (!status) return '—';
  const map = {
    uploaded: 'Uploaded',
    extracting: 'Extracting',
    ready: 'Ready',
    analyzing: 'Analyzing',
    done: 'Done',
    error: 'Error',
    ready_for_analysis: 'Ready',
    queued: 'Queued',
    processing: 'Processing',
    running: 'Running',
    completed: 'Done',
  };
  return map[status.toLowerCase()] || status;
}

function normalizeStatusValue(status) {
  if (!status) return '';
  const value = status.toLowerCase();
  if (value === 'ready_for_analysis') {
    return 'ready';
  }
  if (value === 'completed') {
    return 'done';
  }
  if (['queued', 'processing', 'running'].includes(value)) {
    return 'analyzing';
  }
  return value;
}

async function beginAnalysis() {
  if (!currentUpload?.upload_id) {
    return;
  }

  clearInterval(analysisPollTimer);
  analysisPollTimer = null;
  latestAnalysisResult = null;
  elements.resultsSection.hidden = true;
  elements.analysisStatus.innerHTML = '';

  const promptValue = elements.systemPrompt.value;
  const payload = {
    system_prompt: promptValue,
    prompt: promptValue,
  };

  try {
    elements.analyzeBtn.disabled = true;
    elements.analyzeBtn.textContent = 'Starting…';

    const response = await apiFetch(`/api/analyze/${currentUpload.upload_id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    currentAnalysisId = response.analysis_id;
    elements.analysisStatus.innerHTML = `<span class="spinner" aria-hidden="true"></span> Analysis queued…`;
    updateStatusBadge('analyzing');
    elements.analyzeBtn.textContent = 'Running…';
    startAnalysisPolling();
  } catch (error) {
    elements.analyzeBtn.disabled = false;
    elements.analyzeBtn.textContent = 'Run Issue Spotter';
    showToast(error.message || 'Unable to start analysis.', 'error');
  }
}

function startAnalysisPolling() {
  if (!currentAnalysisId) {
    return;
  }

  async function poll() {
    try {
      const data = await apiFetch(`/api/analyze/${currentAnalysisId}/status`);
      const { status, progress } = data;
      updateStatusBadge(status);

      if (status === 'done') {
        clearInterval(analysisPollTimer);
        analysisPollTimer = null;
        elements.analysisStatus.textContent = 'Analysis complete.';
        elements.analyzeBtn.disabled = false;
        elements.analyzeBtn.textContent = 'Run Issue Spotter';
        fetchAnalysisResult();
      } else if (status === 'error') {
        clearInterval(analysisPollTimer);
        analysisPollTimer = null;
        elements.analysisStatus.textContent = 'Analysis failed.';
        elements.analyzeBtn.disabled = false;
        elements.analyzeBtn.textContent = 'Run Issue Spotter';
        updateStatusBadge('error');
        showToast('Analysis failed. Please retry.', 'error');
      } else {
        let percentText = '';
        if (typeof progress === 'number' && Number.isFinite(progress)) {
          const normalized = progress <= 1 ? Math.round(progress * 100) : Math.round(progress);
          percentText = ` (${normalized}%)`;
        }
        elements.analysisStatus.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${formatStatusLabel(status)}${percentText}`;
      }
    } catch (error) {
      showToast(error.message || 'Unable to check analysis status.', 'error');
    }
  }

  poll();
  analysisPollTimer = setInterval(poll, POLL_MS_ANALYSIS);
}

async function fetchAnalysisResult() {
  if (!currentAnalysisId) return;
  try {
    const result = await apiFetch(`/api/analyze/${currentAnalysisId}/result`);
    latestAnalysisResult = result;
    renderResults(result);
    updateStatusBadge('done');
    showToast('Results ready.', 'success');
  } catch (error) {
    showToast(error.message || 'Could not load analysis result.', 'error');
  }
}

function renderResults(result) {
  if (!result) {
    return;
  }
  elements.resultsSection.hidden = false;
  elements.resultsSection.classList.add('active');
  elements.documentSummary.textContent = result.document_summary || 'No summary provided.';

  const issues = Array.isArray(result.issues) ? result.issues : [];
  elements.issuesContainer.innerHTML = '';

  if (!issues.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No issues were returned by the analysis.';
    elements.issuesContainer.appendChild(empty);
  } else {
    issues.forEach((issue, index) => {
      elements.issuesContainer.appendChild(createIssueCard(issue, index === 0));
    });
  }

  elements.copyJsonBtn.disabled = false;
  elements.downloadJsonBtn.disabled = false;
}

function createIssueCard(issue, open = false) {
  const details = document.createElement('details');
  details.className = 'issue-card';
  details.open = open;
  details.setAttribute('role', 'group');

  const summary = document.createElement('summary');
  const title = issue.title || 'Untitled issue';
  const severity = (issue.severity || 'low').toLowerCase();
  const severityClass = ['high', 'medium', 'low'].includes(severity) ? severity : 'low';
  const pages = issue.page_range || issue.pages || issue.page || '—';

  const summaryLeft = document.createElement('span');
  summaryLeft.textContent = title;

  const meta = document.createElement('span');
  meta.className = 'issue-meta';

  const severityBadge = document.createElement('span');
  severityBadge.className = `severity severity-${severityClass}`;
  severityBadge.textContent = severityClass;
  meta.appendChild(severityBadge);

  const pageLabel = document.createElement('span');
  pageLabel.textContent = `Pages: ${pages}`;
  meta.appendChild(pageLabel);

  summary.append(summaryLeft, meta);
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'issue-content';

  if (issue.rationale) {
    const rationale = document.createElement('p');
    rationale.textContent = issue.rationale;
    body.appendChild(rationale);
  }

  const excerpt = document.createElement('pre');
  excerpt.className = 'issue-excerpt';
  excerpt.textContent = issue.excerpt || issue.text || 'No excerpt provided.';
  body.appendChild(excerpt);

  details.appendChild(body);
  return details;
}

async function copyAnalysisJson() {
  if (!latestAnalysisResult) {
    return;
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(latestAnalysisResult, null, 2));
    showToast('Analysis JSON copied to clipboard.', 'success');
  } catch (error) {
    showToast('Unable to copy to clipboard.', 'error');
  }
}

function downloadAnalysisJson() {
  if (!latestAnalysisResult) {
    return;
  }
  const blob = new Blob([JSON.stringify(latestAnalysisResult, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentUpload?.filename || 'analysis'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadOriginalPdf() {
  if (!currentUpload?.upload_id) {
    return;
  }
  try {
    const blob = await apiFetch(`/api/uploads/${currentUpload.upload_id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentUpload.filename || 'document.pdf';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Download started.', 'success');
  } catch (error) {
    showToast(error.message || 'Unable to download file.', 'error');
  }
}

async function deleteCurrentUpload() {
  if (!currentUpload?.upload_id) {
    return;
  }
  const confirmed = window.confirm('Delete this upload and remove all results?');
  if (!confirmed) {
    return;
  }

  try {
    await apiFetch(`/api/uploads/${currentUpload.upload_id}`, { method: 'DELETE' });
    showToast('Upload deleted.', 'success');
    resetState();
  } catch (error) {
    showToast(error.message || 'Unable to delete upload.', 'error');
  }
}

function resetState() {
  clearSelectedFile();
  elements.uploadInfo.hidden = true;
  elements.resultsSection.hidden = true;
  elements.resultsSection.classList.remove('active');
  elements.actionsRow.hidden = true;
  elements.downloadPdfBtn.disabled = true;
  elements.deleteBtn.disabled = true;
  elements.analysisStatus.textContent = '';
  elements.documentSummary.textContent = '—';
  elements.issuesContainer.innerHTML = '';
  elements.copyJsonBtn.disabled = true;
  elements.downloadJsonBtn.disabled = true;
  elements.analyzeBtn.disabled = true;
  elements.analyzeBtn.textContent = 'Run Issue Spotter';
  currentUpload = null;
  currentAnalysisId = null;
  latestAnalysisResult = null;
  clearInterval(uploadPollTimer);
  clearInterval(analysisPollTimer);
  uploadPollTimer = null;
  analysisPollTimer = null;
}

async function apiFetch(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Authorization': `Bearer ${authToken}`,
      ...headers,
    },
  });

  if (response.status === 401) {
    await handleUnauthorized();
    throw new Error('Unauthorized. Update the API token and try again.');
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    const contentType = response.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        const data = await response.json();
        message = data?.detail || data?.message || message;
      } else {
        const text = await response.text();
        if (text) {
          message = text;
        }
      }
    } catch (error) {
      // Ignore parsing errors and fall back to default message.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.blob();
}

async function handleUnauthorized() {
  showToast('Authentication required. Please provide a valid token.', 'error');
  const newToken = window.prompt('Enter API token for this session:', authToken || '');
  if (newToken && newToken.trim()) {
    authToken = newToken.trim();
    showToast('Token updated for this session.', 'success');
  }
}

function parseXhrError(xhr) {
  const contentType = xhr.getResponseHeader('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(xhr.responseText);
      return data.detail || data.message;
    } catch (error) {
      return null;
    }
  }
  return xhr.responseText;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return '—';
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(power === 0 ? 0 : 2)} ${units[power]}`;
}

function showToast(message, type = 'info') {
  if (!message) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s ease';
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 3600);
}

// Disable JSON actions until results exist
elements.copyJsonBtn.disabled = true;
elements.downloadJsonBtn.disabled = true;
elements.downloadPdfBtn.disabled = true;
elements.deleteBtn.disabled = true;
