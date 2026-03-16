const state = {
  users: [],
  events: [],
  giftCodes: [],
  currentEventId: null,
  board: null,
  mainView: "registered",
  registeredSearch: "",
  boardSearch: "",
  giftApplySearch: "",
  giftSelectedFids: new Set(),
  giftQueueRunning: false,
  giftQueueResults: [],
  giftFailedFids: [],
  giftLastResultByFid: new Map(),
  registeredRankExpanded: {
    R5: true,
    R4: false,
    R3: false,
    R2: false,
    R1: false,
    R0: false,
  },
}

const el = {
  statusBar: document.getElementById("statusBar"),
  mainGrid: document.getElementById("mainGrid"),
  registeredPanel: document.getElementById("registeredPanel"),
  showdownPanel: document.getElementById("showdownPanel"),
  giftCodesPanel: document.getElementById("giftCodesPanel"),
  viewRegisteredBtn: document.getElementById("viewRegisteredBtn"),
  viewShowdownBtn: document.getElementById("viewShowdownBtn"),
  viewGiftCodesBtn: document.getElementById("viewGiftCodesBtn"),
  copyToast: document.getElementById("copyToast"),
  memberRegModal: document.getElementById("memberRegModal"),
  openMemberModalBtn: document.getElementById("openMemberModalBtn"),
  closeMemberModalBtn: document.getElementById("closeMemberModalBtn"),
  eventCreateModal: document.getElementById("eventCreateModal"),
  openEventModalBtn: document.getElementById("openEventModalBtn"),
  closeEventModalBtn: document.getElementById("closeEventModalBtn"),
  giftCodeModal: document.getElementById("giftCodeModal"),
  openGiftCodeModalBtn: document.getElementById("openGiftCodeModalBtn"),
  closeGiftCodeModalBtn: document.getElementById("closeGiftCodeModalBtn"),
  singleFid: document.getElementById("singleFid"),
  bulkFids: document.getElementById("bulkFids"),
  bulkProgress: document.getElementById("bulkProgress"),
  bulkProgressText: document.getElementById("bulkProgressText"),
  bulkProgressMeta: document.getElementById("bulkProgressMeta"),
  bulkProgressFill: document.getElementById("bulkProgressFill"),
  bulkProgressDetail: document.getElementById("bulkProgressDetail"),
  addSingleBtn: document.getElementById("addSingleBtn"),
  addBulkBtn: document.getElementById("addBulkBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  registeredUsersWrap: document.getElementById("registeredUsersWrap"),
  registeredUsers: document.getElementById("registeredUsers"),
  registeredTitle: document.querySelector(".registered-title"),
  registeredSearchInput: document.getElementById("registeredSearchInput"),
  memberSearchInput: document.getElementById("memberSearchInput"),
  eventNameInput: document.getElementById("eventNameInput"),
  createEventBtn: document.getElementById("createEventBtn"),
  eventSelect: document.getElementById("eventSelect"),
  deleteEventBtn: document.getElementById("deleteEventBtn"),
  clearLegion1Btn: document.getElementById("clearLegion1Btn"),
  clearLegion2Btn: document.getElementById("clearLegion2Btn"),
  copyLegion1Btn: document.getElementById("copyLegion1Btn"),
  copyLegion2Btn: document.getElementById("copyLegion2Btn"),
  boardTitle: document.getElementById("boardTitle"),
  boardMeta: document.getElementById("boardMeta"),
  countUnassigned: document.getElementById("countUnassigned"),
  countLegion1: document.getElementById("countLegion1"),
  countLegion2: document.getElementById("countLegion2"),
  unassignedList: document.getElementById("unassignedList"),
  legion1List: document.getElementById("legion1List"),
  legion2List: document.getElementById("legion2List"),
  giftCodeInput: document.getElementById("giftCodeInput"),
  addGiftCodeBtn: document.getElementById("addGiftCodeBtn"),
  giftCodeTopList: document.getElementById("giftCodeTopList"),
  giftCodesList: document.getElementById("giftCodesList"),
  giftApplyCodeSelect: document.getElementById("giftApplyCodeSelect"),
  giftUseSelectedCodeBtn: document.getElementById("giftUseSelectedCodeBtn"),
  giftApplyCodeInput: document.getElementById("giftApplyCodeInput"),
  giftApplySearchInput: document.getElementById("giftApplySearchInput"),
  giftSelectAllBtn: document.getElementById("giftSelectAllBtn"),
  giftClearSelectionBtn: document.getElementById("giftClearSelectionBtn"),
  giftSelectionMeta: document.getElementById("giftSelectionMeta"),
  applyGiftToSelectedBtn: document.getElementById("applyGiftToSelectedBtn"),
  applyGiftToAllBtn: document.getElementById("applyGiftToAllBtn"),
  retryGiftFailedBtn: document.getElementById("retryGiftFailedBtn"),
  giftQueueProgress: document.getElementById("giftQueueProgress"),
  giftQueueText: document.getElementById("giftQueueText"),
  giftQueueMeta: document.getElementById("giftQueueMeta"),
  giftQueueFill: document.getElementById("giftQueueFill"),
  giftQueueDetail: document.getElementById("giftQueueDetail"),
  giftTargetsList: document.getElementById("giftTargetsList"),
  giftQueueResults: document.getElementById("giftQueueResults"),
}

let copyToastTimer = null
const ALLIANCE_RANKS = ["R5", "R4", "R3", "R2", "R1", "R0"]
const GIFT_QUEUE_REQUEST_DELAY_MS = 220
const GIFT_QUEUE_COOLDOWN_EVERY = 15
const GIFT_QUEUE_COOLDOWN_MS = 3500

function normalizeAllianceRank(value) {
  const normalized = safeText(value, "R0")
    .toUpperCase()
    .replace(/\s+/g, "")
  return ALLIANCE_RANKS.includes(normalized) ? normalized : "R0"
}

function getMemberAllianceRank(user) {
  if (!user || typeof user !== "object") {
    return "R0"
  }
  return normalizeAllianceRank(user.alliance_rank ?? user.rank ?? "R0")
}

function isRegisteredRankCollapsible(rank) {
  return rank === "R4" || rank === "R3" || rank === "R2" || rank === "R1" || rank === "R0"
}

function getRegisteredRankExpanded(rank) {
  if (!isRegisteredRankCollapsible(rank)) {
    return true
  }

  const stored = state.registeredRankExpanded?.[rank]
  return typeof stored === "boolean" ? stored : false
}

function setRegisteredRankExpanded(rank, expanded) {
  if (!isRegisteredRankCollapsible(rank)) {
    return
  }

  if (!state.registeredRankExpanded || typeof state.registeredRankExpanded !== "object") {
    state.registeredRankExpanded = {}
  }
  state.registeredRankExpanded[rank] = !!expanded
}

function setStatus(message, type = "info") {
  if (!el.statusBar) {
    return
  }
  el.statusBar.textContent = message
  el.statusBar.dataset.type = type
}

function setMainView(view) {
  const nextView = view === "showdown" || view === "gift-codes" ? view : "registered"
  state.mainView = nextView

  const showRegistered = nextView === "registered"
  const showShowdown = nextView === "showdown"
  const showGiftCodes = nextView === "gift-codes"

  el.registeredPanel?.classList.toggle("hidden", !showRegistered)
  el.showdownPanel?.classList.toggle("hidden", !showShowdown)
  el.giftCodesPanel?.classList.toggle("hidden", !showGiftCodes)
  el.viewRegisteredBtn?.classList.toggle("active", showRegistered)
  el.viewShowdownBtn?.classList.toggle("active", showShowdown)
  el.viewGiftCodesBtn?.classList.toggle("active", showGiftCodes)
}

function showCopyToast(message, type = "success") {
  if (!el.copyToast) {
    return
  }

  el.copyToast.textContent = safeText(message, "")
  el.copyToast.classList.remove("success", "error")
  el.copyToast.classList.add(type === "error" ? "error" : "success")
  el.copyToast.classList.add("show")

  if (copyToastTimer) {
    window.clearTimeout(copyToastTimer)
  }

  copyToastTimer = window.setTimeout(() => {
    el.copyToast?.classList.remove("show")
  }, 1600)
}

function syncBodyModalState() {
  const memberOpen = !!el.memberRegModal && !el.memberRegModal.classList.contains("hidden")
  const eventOpen = !!el.eventCreateModal && !el.eventCreateModal.classList.contains("hidden")
  const giftCodeOpen = !!el.giftCodeModal && !el.giftCodeModal.classList.contains("hidden")

  if (memberOpen || eventOpen || giftCodeOpen) {
    document.body.classList.add("modal-open")
    return
  }

  document.body.classList.remove("modal-open")
}

function setMemberModalOpen(isOpen) {
  if (!el.memberRegModal) {
    return
  }

  if (isOpen) {
    el.memberRegModal.classList.remove("hidden")
    el.memberRegModal.setAttribute("aria-hidden", "false")
    syncBodyModalState()
    return
  }

  el.memberRegModal.classList.add("hidden")
  el.memberRegModal.setAttribute("aria-hidden", "true")
  syncBodyModalState()
}

function setEventModalOpen(isOpen) {
  if (!el.eventCreateModal) {
    return
  }

  if (isOpen) {
    el.eventCreateModal.classList.remove("hidden")
    el.eventCreateModal.setAttribute("aria-hidden", "false")
    syncBodyModalState()
    return
  }

  el.eventCreateModal.classList.add("hidden")
  el.eventCreateModal.setAttribute("aria-hidden", "true")
  syncBodyModalState()
}

function setGiftCodeModalOpen(isOpen) {
  if (!el.giftCodeModal) {
    return
  }

  if (isOpen) {
    el.giftCodeModal.classList.remove("hidden")
    el.giftCodeModal.setAttribute("aria-hidden", "false")
    syncBodyModalState()
    return
  }

  el.giftCodeModal.classList.add("hidden")
  el.giftCodeModal.setAttribute("aria-hidden", "true")
  syncBodyModalState()
}

function setBulkProgress({
  visible,
  done,
  total,
  failed = 0,
  currentFid = null,
  phase = "waiting",
}) {
  if (!el.bulkProgress || !el.bulkProgressText || !el.bulkProgressMeta || !el.bulkProgressFill || !el.bulkProgressDetail) {
    return
  }

  if (!visible) {
    el.bulkProgress.classList.add("hidden")
    return
  }

  el.bulkProgress.classList.remove("hidden")

  const safeTotal = Math.max(0, Number(total) || 0)
  const safeDone = Math.min(safeTotal, Math.max(0, Number(done) || 0))
  const safeFailed = Math.max(0, Number(failed) || 0)
  const waiting = Math.max(0, safeTotal - safeDone)
  const success = Math.max(0, safeDone - safeFailed)
  const ratio = safeTotal === 0 ? 0 : (safeDone / safeTotal) * 100

  el.bulkProgressText.textContent = `${safeDone}/${safeTotal}`
  el.bulkProgressMeta.textContent = `Success ${success} | Failed ${safeFailed} | Waiting ${waiting}`
  el.bulkProgressFill.style.width = `${ratio}%`

  if (phase === "done") {
    el.bulkProgressDetail.textContent = "Queue complete."
    return
  }

  if (phase === "error") {
    el.bulkProgressDetail.textContent = "Queue stopped because of error."
    return
  }

  if (phase === "cooldown") {
    el.bulkProgressDetail.textContent = "Cooling down to avoid rate limit..."
    return
  }

  if (currentFid !== null && currentFid !== undefined) {
    el.bulkProgressDetail.textContent = `Processing FID ${currentFid}...`
    return
  }

  el.bulkProgressDetail.textContent = "Preparing queue..."
}

function setBulkUiBusy(isBusy) {
  if (el.addSingleBtn) {
    el.addSingleBtn.disabled = isBusy
  }
  if (el.addBulkBtn) {
    el.addBulkBtn.disabled = isBusy
  }
  if (el.refreshBtn) {
    el.refreshBtn.disabled = isBusy
  }
  if (el.singleFid) {
    el.singleFid.disabled = isBusy
  }
  if (el.bulkFids) {
    el.bulkFids.disabled = isBusy
  }
}

function safeText(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback
  }
  return String(value)
}

function getMemberNickname(user) {
  if (!user || typeof user !== "object") {
    return ""
  }
  return safeText(
    user.nickname ?? user.nick_name ?? user.name ?? user.player_name,
    ""
  )
}

function normalizeMemberName(value) {
  return safeText(value, "")
    .normalize("NFKC")
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function getMemberAvatar(user) {
  if (!user || typeof user !== "object") {
    return ""
  }

  const candidate = safeText(
    user.avatar_image ?? user.avatar ?? user.image ?? "",
    ""
  ).trim()

  if (!candidate) {
    return ""
  }

  if (!/^https?:\/\//i.test(candidate)) {
    return ""
  }

  return candidate
}

function getAvatarFallbackText(user) {
  const normalizedName = normalizeMemberName(getMemberNickname(user)).replace(/\s+/g, "")
  if (normalizedName) {
    return normalizedName.slice(0, 2).toUpperCase()
  }

  const fidText = safeText(user?.fid, "").trim()
  if (fidText) {
    return fidText.slice(-2)
  }

  return "?"
}

function createAvatarElement(user, sizeClass = "md") {
  const wrapper = document.createElement("div")
  wrapper.className = `avatar ${sizeClass}`.trim()

  const fallback = document.createElement("span")
  fallback.className = "avatar-fallback"
  fallback.textContent = getAvatarFallbackText(user)

  const avatarUrl = getMemberAvatar(user)
  if (avatarUrl) {
    const image = document.createElement("img")
    image.src = avatarUrl
    image.alt = `${safeText(getMemberNickname(user), "Unknown")} avatar`
    image.loading = "lazy"
    image.decoding = "async"
    image.referrerPolicy = "no-referrer"
    image.addEventListener("load", () => {
      wrapper.classList.add("loaded")
    })
    image.addEventListener("error", () => {
      image.remove()
    })
    wrapper.appendChild(image)
  }

  wrapper.appendChild(fallback)
  return wrapper
}

function normalizeSearchText(value) {
  return normalizeMemberName(value)
    .toLowerCase()
}

function getSearchTerms(rawInput = "") {
  const raw = safeText(rawInput, "")
    .normalize("NFKC")
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, " ")

  const parts = raw
    .split(/[,\n;]+/)
    .map((part) => normalizeSearchText(part))
    .filter(Boolean)

  if (parts.length === 0) {
    return []
  }

  return Array.from(new Set(parts))
}

function isEditDistanceAtMostOne(a, b) {
  const left = safeText(a, "")
  const right = safeText(b, "")

  const leftLen = left.length
  const rightLen = right.length
  if (Math.abs(leftLen - rightLen) > 1) {
    return false
  }
  if (left === right) {
    return true
  }

  let i = 0
  let j = 0
  let edits = 0

  while (i < leftLen && j < rightLen) {
    if (left[i] === right[j]) {
      i += 1
      j += 1
      continue
    }

    edits += 1
    if (edits > 1) {
      return false
    }

    if (leftLen > rightLen) {
      i += 1
      continue
    }

    if (leftLen < rightLen) {
      j += 1
      continue
    }

    i += 1
    j += 1
  }

  if (i < leftLen || j < rightLen) {
    edits += 1
  }

  return edits <= 1
}

function normalizeNameForCopy(user) {
  const nickname = normalizeMemberName(getMemberNickname(user))
  if (nickname) {
    return nickname
  }
  return `FID${safeText(user?.fid, "")}`
}

function parseFids(text) {
  const parts = String(text || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

  const result = []
  const seen = new Set()

  for (const part of parts) {
    const num = Number(part)
    if (!Number.isInteger(num) || num <= 0) {
      continue
    }
    if (!seen.has(num)) {
      seen.add(num)
      result.push(num)
    }
  }

  return result
}

function memberMatchesSingleQuery(user, query) {
  if (!query) {
    return true
  }

  const nickname = normalizeSearchText(getMemberNickname(user))
  const fid = normalizeSearchText(user?.fid)
  const compactQuery = query.replace(/\s+/g, "")
  const compactNickname = nickname.replace(/\s+/g, "")

  const directMatch = (
    nickname.includes(query) ||
    fid.includes(query) ||
    (compactQuery && compactNickname.includes(compactQuery))
  )

  if (directMatch) {
    return true
  }

  if (compactQuery.length < 6) {
    return false
  }

  return isEditDistanceAtMostOne(compactQuery, compactNickname)
}

function memberMatchesSearch(user, terms) {
  if (!terms || terms.length === 0) {
    return true
  }
  return terms.some((term) => memberMatchesSingleQuery(user, term))
}

function filterMembersBySearch(users, terms = []) {
  const list = Array.isArray(users) ? users : []
  if (!terms || terms.length === 0) {
    return list
  }
  return list.filter((user) => memberMatchesSearch(user, terms))
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const temp = document.createElement("textarea")
  temp.value = text
  temp.style.position = "fixed"
  temp.style.left = "-9999px"
  document.body.appendChild(temp)
  temp.focus()
  temp.select()
  document.execCommand("copy")
  document.body.removeChild(temp)
}

function buildLegionCopyText(title, users) {
  const names = users.map((user) => normalizeNameForCopy(user))
  return `${title}:-\n${names.join(", ")}`
}

async function copyLegionList(legionKey) {
  if (!state.board) {
    setStatus("Select an event first.", "error")
    showCopyToast("Select an event first.", "error")
    return
  }

  const users = legionKey === "legion1" ? state.board.legion1 : state.board.legion2
  const title = legionKey === "legion1" ? "legion 1" : "legion 2"

  if (!users || users.length === 0) {
    setStatus(`${title} has no members to copy.`, "error")
    showCopyToast(`${title} has no members to copy.`, "error")
    return
  }

  try {
    await copyText(buildLegionCopyText(title, users))
    setStatus(`${title} list copied (${users.length}).`, "success")
    showCopyToast(`${title} copied.`, "success")
  } catch (_error) {
    setStatus(`Could not copy ${title} list.`, "error")
    showCopyToast(`Could not copy ${title}.`, "error")
  }
}

async function api(path, options = {}) {
  const config = {
    method: options.method || "GET",
    headers: {
      ...(options.headers || {}),
    },
  }

  if (options.body !== undefined) {
    config.headers["Content-Type"] = "application/json"
    config.body = JSON.stringify(options.body)
  }

  const response = await fetch(path, config)
  const text = await response.text()
  let payload = {}

  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { msg: text }
    }
  }

  if (!response.ok || payload.code === 1) {
    const err = new Error(payload.msg || `Request failed (${response.status})`)
    err.status = response.status
    err.payload = payload
    throw err
  }

  return payload
}

async function refreshUsers() {
  const res = await api("/users")
  state.users = Array.isArray(res.data) ? res.data : []
  trimGiftSelections()
  renderRegisteredUsers()
  renderGiftTargets()
}

async function refreshEvents() {
  const res = await api("/events")
  state.events = Array.isArray(res.data) ? res.data : []

  if (state.events.length === 0) {
    state.currentEventId = null
  } else {
    const exists = state.events.some((event) => event.id === state.currentEventId)
    if (!exists) {
      state.currentEventId = state.events[0].id
    }
  }

  renderEventSelector()
}

async function refreshBoard() {
  if (!state.currentEventId) {
    state.board = null
    renderBoard()
    return
  }

  const res = await api(`/events/${state.currentEventId}/board`)
  state.board = res.data
  renderBoard()
}

async function refreshGiftCodes() {
  const res = await api("/gift-codes")
  state.giftCodes = Array.isArray(res.data) ? res.data : []
  renderGiftCodes()
}

async function refreshAll() {
  await refreshUsers()
  await refreshGiftCodes()
  await refreshEvents()
  await refreshBoard()
}

function normalizeGiftCodeValue(value) {
  const code = safeText(value, "").trim()
  if (!code) {
    return { ok: false, message: "Enter a gift code first." }
  }
  if (code.length > 64) {
    return { ok: false, message: "Gift code is too long." }
  }
  if (/\s/.test(code)) {
    return { ok: false, message: "Gift code cannot contain spaces." }
  }
  return { ok: true, code }
}

function resolveGiftCodeToApply() {
  const manualInput = safeText(el.giftApplyCodeInput?.value, "").trim()
  const selectedInput = safeText(el.giftApplyCodeSelect?.value, "").trim()
  const candidate = manualInput || selectedInput
  const normalized = normalizeGiftCodeValue(candidate)
  if (!normalized.ok) {
    return normalized
  }
  return { ok: true, code: normalized.code }
}

function shortGiftText(value, maxLen = 100) {
  const text = safeText(value, "").trim()
  if (!text) {
    return ""
  }
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}...`
}

function trimGiftSelections() {
  const available = new Set()
  for (const user of state.users) {
    const fid = Number(user?.fid)
    if (Number.isInteger(fid) && fid > 0) {
      available.add(fid)
    }
  }

  for (const manualTarget of getManualGiftTargetsFromSearch()) {
    const fid = Number(manualTarget?.fid)
    if (Number.isInteger(fid) && fid > 0) {
      available.add(fid)
    }
  }

  for (const fid of Array.from(state.giftSelectedFids)) {
    if (!available.has(fid)) {
      state.giftSelectedFids.delete(fid)
    }
  }

  state.giftFailedFids = Array.from(
    new Set(
      (Array.isArray(state.giftFailedFids) ? state.giftFailedFids : [])
        .map((fid) => Number(fid))
        .filter((fid) => Number.isInteger(fid) && fid > 0)
    )
  )
}

function createManualGiftTarget(fid) {
  return {
    fid,
    nickname: `Manual FID ${fid}`,
    stove_lv: null,
    alliance_rank: "R0",
    is_manual: true,
  }
}

function getManualGiftTargetsFromSearch() {
  const parsedFids = parseFids(state.giftApplySearch)
  if (parsedFids.length === 0) {
    return []
  }

  const registeredFids = new Set(
    (Array.isArray(state.users) ? state.users : [])
      .map((user) => Number(user?.fid))
      .filter((fid) => Number.isInteger(fid) && fid > 0)
  )

  const manualTargets = []
  for (const fid of parsedFids) {
    if (registeredFids.has(fid)) {
      continue
    }
    manualTargets.push(createManualGiftTarget(fid))
  }

  return manualTargets
}

function getGiftTargetLookupByFid() {
  const byFid = new Map()

  for (const user of Array.isArray(state.users) ? state.users : []) {
    const fid = Number(user?.fid)
    if (!Number.isInteger(fid) || fid <= 0 || byFid.has(fid)) {
      continue
    }
    byFid.set(fid, user)
  }

  for (const manualTarget of getManualGiftTargetsFromSearch()) {
    const fid = Number(manualTarget?.fid)
    if (!Number.isInteger(fid) || fid <= 0 || byFid.has(fid)) {
      continue
    }
    byFid.set(fid, manualTarget)
  }

  return byFid
}

function getFilteredGiftTargets() {
  const terms = getSearchTerms(state.giftApplySearch)
  const filteredRegistered = filterMembersBySearch(state.users, terms)
  const manualTargets = getManualGiftTargetsFromSearch()
  return [...manualTargets, ...filteredRegistered]
}

function getSelectedGiftTargets() {
  if (state.giftSelectedFids.size === 0) {
    return []
  }

  const byFid = getGiftTargetLookupByFid()
  const selectedTargets = []

  for (const fid of Array.from(state.giftSelectedFids)) {
    const target = byFid.get(Number(fid))
    if (target) {
      selectedTargets.push(target)
      continue
    }

    if (Number.isInteger(Number(fid)) && Number(fid) > 0) {
      selectedTargets.push(createManualGiftTarget(Number(fid)))
    }
  }

  return selectedTargets
}

function getFailedGiftTargets() {
  if (!Array.isArray(state.giftFailedFids) || state.giftFailedFids.length === 0) {
    return []
  }

  const byFid = getGiftTargetLookupByFid()
  const failedTargets = []

  for (const rawFid of state.giftFailedFids) {
    const fid = Number(rawFid)
    if (!Number.isInteger(fid) || fid <= 0) {
      continue
    }

    const target = byFid.get(fid)
    if (target) {
      failedTargets.push(target)
      continue
    }

    failedTargets.push(createManualGiftTarget(fid))
  }

  return failedTargets
}

function setGiftQueueProgress({
  visible,
  done,
  total,
  success = 0,
  failed = 0,
  currentLabel = "",
  phase = "waiting",
}) {
  if (!el.giftQueueProgress || !el.giftQueueText || !el.giftQueueMeta || !el.giftQueueFill || !el.giftQueueDetail) {
    return
  }

  if (!visible) {
    el.giftQueueProgress.classList.add("hidden")
    return
  }

  el.giftQueueProgress.classList.remove("hidden")

  const safeTotal = Math.max(0, Number(total) || 0)
  const safeDone = Math.min(safeTotal, Math.max(0, Number(done) || 0))
  const safeFailed = Math.max(0, Number(failed) || 0)
  const safeSuccess = Math.max(0, Number(success) || 0)
  const waiting = Math.max(0, safeTotal - safeDone)
  const ratio = safeTotal === 0 ? 0 : (safeDone / safeTotal) * 100

  el.giftQueueText.textContent = `${safeDone}/${safeTotal}`
  el.giftQueueMeta.textContent = `Success ${safeSuccess} | Failed ${safeFailed} | Waiting ${waiting}`
  el.giftQueueFill.style.width = `${ratio}%`

  if (phase === "done") {
    el.giftQueueDetail.textContent = "Gift queue complete."
    return
  }

  if (phase === "cooldown") {
    el.giftQueueDetail.textContent = "Cooling down to avoid rate limit..."
    return
  }

  if (phase === "error") {
    el.giftQueueDetail.textContent = "Queue stopped because of error."
    return
  }

  if (currentLabel) {
    el.giftQueueDetail.textContent = `Applying code to ${currentLabel}...`
    return
  }

  el.giftQueueDetail.textContent = "Preparing gift queue..."
}

function renderGiftQueueResults() {
  if (!el.giftQueueResults) {
    return
  }

  el.giftQueueResults.innerHTML = ""

  if (!Array.isArray(state.giftQueueResults) || state.giftQueueResults.length === 0) {
    el.giftQueueResults.innerHTML = `<div class="empty">No apply history yet.</div>`
    return
  }

  const rows = [...state.giftQueueResults].reverse()
  for (const item of rows) {
    const row = document.createElement("div")
    row.className = `gift-queue-row ${item.status === "success" ? "success" : "error"}`

    const head = document.createElement("div")
    head.className = "gift-queue-row-head"

    const title = document.createElement("div")
    title.className = "gift-queue-row-title"
    title.textContent = `${safeText(item.nickname, "Unknown")} (FID ${safeText(item.fid)})`

    const badge = document.createElement("span")
    badge.className = `gift-target-badge ${item.status === "success" ? "success" : "error"}`
    badge.textContent = item.status === "success" ? "SUCCESS" : "FAILED"

    head.appendChild(title)
    head.appendChild(badge)

    const meta = document.createElement("div")
    meta.className = "gift-queue-row-meta"
    const codeText = safeText(item.code, "-")
    const message = shortGiftText(item.message || "-", 120)
    const appliedAt = safeText(item.appliedAt, "-")
    meta.textContent = `Code ${codeText} | ${message} | ${appliedAt}`

    row.appendChild(head)
    row.appendChild(meta)
    el.giftQueueResults.appendChild(row)
  }
}

function renderGiftTargets() {
  if (!el.giftTargetsList) {
    return
  }

  const filteredUsers = getFilteredGiftTargets()
  const selectedCount = getSelectedGiftTargets().length
  const registeredCount = Array.isArray(state.users) ? state.users.length : 0
  const queueRunning = state.giftQueueRunning

  if (el.giftSelectionMeta) {
    el.giftSelectionMeta.textContent = `Selected ${selectedCount} | Visible ${filteredUsers.length} | Registered ${registeredCount}`
  }

  if (el.giftSelectAllBtn) {
    el.giftSelectAllBtn.disabled = queueRunning || filteredUsers.length === 0
  }
  if (el.giftClearSelectionBtn) {
    el.giftClearSelectionBtn.disabled = queueRunning || state.giftSelectedFids.size === 0
  }
  if (el.applyGiftToSelectedBtn) {
    el.applyGiftToSelectedBtn.disabled = queueRunning || selectedCount === 0
  }
  if (el.applyGiftToAllBtn) {
    el.applyGiftToAllBtn.disabled = queueRunning || registeredCount === 0
  }
  if (el.retryGiftFailedBtn) {
    el.retryGiftFailedBtn.disabled = queueRunning || state.giftFailedFids.length === 0
  }
  if (el.giftUseSelectedCodeBtn) {
    el.giftUseSelectedCodeBtn.disabled = queueRunning
  }
  if (el.giftApplyCodeSelect) {
    el.giftApplyCodeSelect.disabled = queueRunning
  }
  if (el.giftApplyCodeInput) {
    el.giftApplyCodeInput.disabled = queueRunning
  }

  el.giftTargetsList.innerHTML = ""
  if (filteredUsers.length === 0) {
    const emptyMessage = registeredCount === 0 ? "No registered members yet." : "No matching member."
    el.giftTargetsList.innerHTML = `<div class="empty">${emptyMessage}</div>`
    return
  }

  for (const user of filteredUsers) {
    const fid = Number(user?.fid)
    if (!Number.isInteger(fid) || fid <= 0) {
      continue
    }

    const nickname = safeText(getMemberNickname(user), "Unknown")
    const row = document.createElement("div")
    row.className = "gift-target-row"

    const main = document.createElement("div")
    main.className = "gift-target-main"

    const check = document.createElement("input")
    check.type = "checkbox"
    check.className = "gift-target-check"
    check.checked = state.giftSelectedFids.has(fid)
    check.disabled = queueRunning
    check.addEventListener("change", () => {
      if (check.checked) {
        state.giftSelectedFids.add(fid)
      } else {
        state.giftSelectedFids.delete(fid)
      }
      renderGiftTargets()
    })

    const info = document.createElement("div")
    info.className = "gift-target-info"

    const title = document.createElement("div")
    title.className = "gift-target-title"
    title.textContent = nickname

    const meta = document.createElement("div")
    meta.className = "gift-target-meta"
    if (user?.is_manual) {
      meta.textContent = `FID ${fid} | Manual target (not registered)`
    } else {
      meta.textContent = `FID ${fid} | Town Center ${safeText(user?.stove_lv)} | Rank ${getMemberAllianceRank(user)}`
    }

    info.appendChild(title)
    info.appendChild(meta)

    if (user?.is_manual) {
      const manualBadge = document.createElement("span")
      manualBadge.className = "gift-target-badge info"
      manualBadge.textContent = "MANUAL"
      info.appendChild(manualBadge)
    }

    const lastResult = state.giftLastResultByFid.get(fid)
    if (lastResult) {
      const lastWrap = document.createElement("div")
      lastWrap.className = "gift-target-last"

      const badge = document.createElement("span")
      badge.className = `gift-target-badge ${lastResult.status === "success" ? "success" : "error"}`
      badge.textContent = lastResult.status === "success" ? "SUCCESS" : "FAILED"

      const message = document.createElement("span")
      message.className = "gift-target-last-msg"
      message.textContent = shortGiftText(lastResult.message || "")

      lastWrap.appendChild(badge)
      if (message.textContent) {
        lastWrap.appendChild(message)
      }
      info.appendChild(lastWrap)
    }

    main.appendChild(check)
    main.appendChild(createAvatarElement(user, "sm"))
    main.appendChild(info)

    const actions = document.createElement("div")
    actions.className = "gift-target-actions"

    const applyOneBtn = document.createElement("button")
    applyOneBtn.className = "btn sm"
    applyOneBtn.type = "button"
    applyOneBtn.textContent = "Apply"
    applyOneBtn.disabled = queueRunning
    applyOneBtn.addEventListener("click", async () => {
      await onApplyGiftToSingle(user)
    })

    actions.appendChild(applyOneBtn)
    row.appendChild(main)
    row.appendChild(actions)
    el.giftTargetsList.appendChild(row)
  }
}

function renderGiftCodeSelect() {
  if (!el.giftApplyCodeSelect) {
    return
  }

  const previous = safeText(el.giftApplyCodeSelect.value, "").trim()
  const codes = Array.isArray(state.giftCodes) ? state.giftCodes : []

  el.giftApplyCodeSelect.innerHTML = ""

  const placeholder = document.createElement("option")
  placeholder.value = ""
  placeholder.textContent = codes.length === 0 ? "No saved codes" : "Select saved code"
  el.giftApplyCodeSelect.appendChild(placeholder)

  for (const codeItem of codes) {
    const codeText = safeText(codeItem?.code, "").trim()
    if (!codeText) {
      continue
    }
    const option = document.createElement("option")
    option.value = codeText
    option.textContent = codeText
    if (codeText === previous) {
      option.selected = true
    }
    el.giftApplyCodeSelect.appendChild(option)
  }

  if (!el.giftApplyCodeSelect.value && codes.length > 0) {
    el.giftApplyCodeSelect.value = safeText(codes[0]?.code, "")
  }
}

function pickGiftCodeForApply(code) {
  const normalized = normalizeGiftCodeValue(code)
  if (!normalized.ok) {
    return
  }

  if (el.giftApplyCodeInput) {
    el.giftApplyCodeInput.value = normalized.code
  }

  if (el.giftApplyCodeSelect) {
    const options = Array.from(el.giftApplyCodeSelect.options || [])
    const matched = options.find((option) => option.value === normalized.code)
    if (matched) {
      el.giftApplyCodeSelect.value = normalized.code
    }
  }
}

function renderGiftCodes() {
  if (!el.giftCodeTopList || !el.giftCodesList) {
    return
  }

  const queueRunning = state.giftQueueRunning
  if (el.giftCodeInput) {
    el.giftCodeInput.disabled = queueRunning
  }
  if (el.addGiftCodeBtn) {
    el.addGiftCodeBtn.disabled = queueRunning
  }
  if (el.openGiftCodeModalBtn) {
    el.openGiftCodeModalBtn.disabled = queueRunning
  }

  el.giftCodeTopList.innerHTML = ""
  el.giftCodesList.innerHTML = ""
  renderGiftCodeSelect()

  const codes = Array.isArray(state.giftCodes) ? state.giftCodes : []
  let rendered = 0

  for (const codeItem of codes) {
    const codeText = safeText(codeItem?.code, "").trim()
    const codeId = Number(codeItem?.id)
    if (!codeText || !Number.isInteger(codeId) || codeId <= 0) {
      continue
    }

    const chip = document.createElement("button")
    chip.type = "button"
    chip.className = "gift-chip"
    chip.textContent = codeText
    chip.disabled = queueRunning
    chip.addEventListener("click", () => {
      pickGiftCodeForApply(codeText)
      setStatus(`Gift code ${codeText} selected for apply.`, "info")
    })
    el.giftCodeTopList.appendChild(chip)

    const row = document.createElement("div")
    row.className = "gift-code-row"

    const textEl = document.createElement("div")
    textEl.className = "gift-code-text"
    textEl.textContent = codeText

    const actions = document.createElement("div")
    actions.className = "gift-code-row-actions"

    const useBtn = document.createElement("button")
    useBtn.className = "btn ghost sm"
    useBtn.type = "button"
    useBtn.textContent = "Use"
    useBtn.disabled = queueRunning
    useBtn.addEventListener("click", () => {
      pickGiftCodeForApply(codeText)
      setStatus(`Gift code ${codeText} selected for apply.`, "info")
    })

    const deleteBtn = document.createElement("button")
    deleteBtn.className = "btn danger sm"
    deleteBtn.type = "button"
    deleteBtn.textContent = "Delete"
    deleteBtn.disabled = queueRunning
    deleteBtn.addEventListener("click", async () => {
      await onDeleteGiftCode(codeId, codeText)
    })

    actions.appendChild(useBtn)
    actions.appendChild(deleteBtn)
    row.appendChild(textEl)
    row.appendChild(actions)
    el.giftCodesList.appendChild(row)
    rendered += 1
  }

  if (rendered === 0) {
    el.giftCodeTopList.innerHTML = `<div class="empty">No gift codes yet.</div>`
    el.giftCodesList.innerHTML = `<div class="empty">No gift codes yet.</div>`
  }

  renderGiftTargets()
  renderGiftQueueResults()
}

function renderRegisteredUsers() {
  if (!el.registeredUsers) {
    return
  }

  if (el.registeredTitle) {
    el.registeredTitle.textContent = `Registered Members (${state.users.length})`
  }

  el.registeredUsers.innerHTML = ""

  if (state.users.length === 0) {
    el.registeredUsers.innerHTML = `<div class="empty">No registered members yet.</div>`
    return
  }

  const searchTerms = getSearchTerms(state.registeredSearch)
  const filteredUsers = filterMembersBySearch(state.users, searchTerms)
  if (filteredUsers.length === 0) {
    el.registeredUsers.innerHTML = `<div class="empty">No matching member.</div>`
    return
  }

  const groupedUsers = new Map(ALLIANCE_RANKS.map((rank) => [rank, []]))
  for (const user of filteredUsers) {
    const rank = getMemberAllianceRank(user)
    const bucket = groupedUsers.get(rank)
    if (bucket) {
      bucket.push(user)
      continue
    }
    groupedUsers.get("R0")?.push(user)
  }

  const hasSearch = searchTerms.length > 0

  for (const rank of ALLIANCE_RANKS) {
    const usersInRank = groupedUsers.get(rank) || []
    if (hasSearch && usersInRank.length === 0) {
      continue
    }
    const collapsible = isRegisteredRankCollapsible(rank)
    const expanded = hasSearch ? true : getRegisteredRankExpanded(rank)

    const group = document.createElement("section")
    group.className = "rank-group"
    if (collapsible && !expanded) {
      group.classList.add("collapsed")
    }

    const header = document.createElement("div")
    header.className = "rank-group-head"

    const title = document.createElement("span")
    title.className = "rank-badge"
    title.textContent = rank

    const count = document.createElement("span")
    count.className = "rank-count"
    count.textContent = `${usersInRank.length}`

    const headerTools = document.createElement("div")
    headerTools.className = "rank-group-tools"
    headerTools.appendChild(count)

    if (collapsible) {
      const toggleBtn = document.createElement("button")
      toggleBtn.type = "button"
      toggleBtn.className = "btn ghost xs rank-toggle"
      toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false")
      toggleBtn.setAttribute(
        "aria-label",
        expanded ? `${rank} collapse` : `${rank} expand`
      )

      const chevron = document.createElement("span")
      chevron.className = "rank-toggle-chevron"
      chevron.textContent = ">"
      toggleBtn.appendChild(chevron)

      toggleBtn.addEventListener("click", () => {
        setRegisteredRankExpanded(rank, !expanded)
        renderRegisteredUsers()
      })
      headerTools.appendChild(toggleBtn)
    }

    header.appendChild(title)
    header.appendChild(headerTools)
    group.appendChild(header)

    if (collapsible && !expanded) {
      el.registeredUsers.appendChild(group)
      continue
    }

    const groupBody = document.createElement("div")
    groupBody.className = "stack rank-group-body"

    if (usersInRank.length === 0) {
      groupBody.innerHTML = `<div class="empty">No members</div>`
      group.appendChild(groupBody)
      el.registeredUsers.appendChild(group)
      continue
    }

    for (const user of usersInRank) {
      const row = document.createElement("div")
      row.className = "user-row"

      const main = document.createElement("div")
      main.className = "user-row-main"

      const info = document.createElement("div")
      info.className = "user-row-info"
      const nickname = safeText(getMemberNickname(user), "Unknown")
      const nameEl = document.createElement("div")
      nameEl.className = "name"
      nameEl.textContent = nickname

      const metaEl = document.createElement("div")
      metaEl.className = "meta"
      metaEl.textContent = `FID ${safeText(user.fid)} | Town Center ${safeText(user.stove_lv)}`

      info.appendChild(nameEl)
      info.appendChild(metaEl)
      main.appendChild(createAvatarElement(user, "md"))
      main.appendChild(info)

      const actions = document.createElement("div")
      actions.className = "user-row-actions"

      let currentRank = getMemberAllianceRank(user)
      const rankSelect = document.createElement("select")
      rankSelect.className = "rank-select"
      for (const optionRank of ALLIANCE_RANKS) {
        const option = document.createElement("option")
        option.value = optionRank
        option.textContent = optionRank
        rankSelect.appendChild(option)
      }
      rankSelect.value = currentRank
      rankSelect.addEventListener("change", async () => {
        const nextRank = normalizeAllianceRank(rankSelect.value)
        if (nextRank === currentRank) {
          return
        }

        rankSelect.disabled = true
        const updated = await onUpdateUserRank(user.fid, nextRank)
        rankSelect.disabled = false

        if (!updated) {
          rankSelect.value = currentRank
          return
        }

        currentRank = nextRank
      })

      const removeBtn = document.createElement("button")
      removeBtn.className = "btn danger"
      removeBtn.textContent = "Delete"
      removeBtn.addEventListener("click", async () => {
        const ok = window.confirm(`Delete user ${nickname} (FID ${user.fid})?`)
        if (!ok) {
          return
        }

        try {
          await api(`/users/${user.fid}`, { method: "DELETE" })
          setStatus(`User ${user.fid} deleted.`, "success")
          await refreshAll()
        } catch (error) {
          setStatus(error.message, "error")
        }
      })

      actions.appendChild(rankSelect)
      actions.appendChild(removeBtn)
      row.appendChild(main)
      row.appendChild(actions)
      groupBody.appendChild(row)
    }

    group.appendChild(groupBody)
    el.registeredUsers.appendChild(group)
  }
}

function renderEventSelector() {
  if (!el.eventSelect || !el.deleteEventBtn || !el.clearLegion1Btn || !el.clearLegion2Btn) {
    return
  }

  el.eventSelect.innerHTML = ""

  if (state.events.length === 0) {
    const option = document.createElement("option")
    option.value = ""
    option.textContent = "No events yet"
    el.eventSelect.appendChild(option)
    el.eventSelect.disabled = true
    el.deleteEventBtn.disabled = true
    el.clearLegion1Btn.disabled = true
    el.clearLegion2Btn.disabled = true
    return
  }

  el.eventSelect.disabled = false
  el.deleteEventBtn.disabled = false
  el.clearLegion1Btn.disabled = false
  el.clearLegion2Btn.disabled = false

  for (const event of state.events) {
    const option = document.createElement("option")
    option.value = String(event.id)
    option.textContent = `${event.name} (L1 ${event.legion1_count} / L2 ${event.legion2_count})`
    if (event.id === state.currentEventId) {
      option.selected = true
    }
    el.eventSelect.appendChild(option)
  }
}

function createMemberCard(user, zone) {
  const card = document.createElement("article")
  card.className = "member-card"

  const nickname = safeText(getMemberNickname(user), "Unknown")
  const fid = safeText(user.fid)
  const stove = safeText(user.stove_lv)

  const head = document.createElement("div")
  head.className = "member-head"

  const textWrap = document.createElement("div")
  textWrap.className = "member-text"

  const titleEl = document.createElement("p")
  titleEl.className = "title"
  titleEl.textContent = nickname

  const subEl = document.createElement("p")
  subEl.className = "sub"
  subEl.textContent = `FID ${fid} | Town Center ${stove}`

  textWrap.appendChild(titleEl)
  textWrap.appendChild(subEl)

  head.appendChild(createAvatarElement(user, "sm"))
  head.appendChild(textWrap)

  const actions = document.createElement("div")
  actions.className = "actions"

  card.appendChild(head)
  card.appendChild(actions)

  const addAction = (label, className, onClick) => {
    const btn = document.createElement("button")
    btn.className = `btn ${className}`.trim()
    btn.textContent = label
    btn.addEventListener("click", onClick)
    actions.appendChild(btn)
  }

  if (zone === "unassigned") {
    addAction("To Legion 1", "", () => moveUserToLegion(user.fid, "legion1"))
    addAction("To Legion 2", "", () => moveUserToLegion(user.fid, "legion2"))
  }

  if (zone === "legion1") {
    addAction("Move to Legion 2", "", () => moveUserToLegion(user.fid, "legion2"))
    addAction("Unassign", "ghost", () => unassignFromEvent(user.fid))
  }

  if (zone === "legion2") {
    addAction("Move to Legion 1", "", () => moveUserToLegion(user.fid, "legion1"))
    addAction("Unassign", "ghost", () => unassignFromEvent(user.fid))
  }

  return card
}

function fillColumn(container, users, zone) {
  if (!container) {
    return
  }

  container.innerHTML = ""

  if (!users || users.length === 0) {
    container.innerHTML = `<div class="empty">No members</div>`
    return
  }

  for (const user of users) {
    container.appendChild(createMemberCard(user, zone))
  }
}

function renderBoard() {
  if (!el.boardTitle || !el.boardMeta || !el.countUnassigned || !el.countLegion1 || !el.countLegion2) {
    return
  }

  if (!state.currentEventId || !state.board) {
    el.boardTitle.textContent = "No event selected"
    el.boardMeta.textContent = "Create an event to start team assignment."
    el.countUnassigned.textContent = "0"
    el.countLegion1.textContent = "0"
    el.countLegion2.textContent = "0"

    if (el.copyLegion1Btn) {
      el.copyLegion1Btn.disabled = true
    }
    if (el.copyLegion2Btn) {
      el.copyLegion2Btn.disabled = true
    }

    fillColumn(el.unassignedList, [], "unassigned")
    fillColumn(el.legion1List, [], "legion1")
    fillColumn(el.legion2List, [], "legion2")
    return
  }

  el.boardTitle.textContent = state.board.event.name
  el.boardMeta.textContent = `created at ${state.board.event.created_at}`

  const searchTerms = getSearchTerms(state.boardSearch)
  const unassignedFiltered = filterMembersBySearch(state.board.unassigned, searchTerms)
  const legion1Filtered = filterMembersBySearch(state.board.legion1, searchTerms)
  const legion2Filtered = filterMembersBySearch(state.board.legion2, searchTerms)
  const hasSearch = searchTerms.length > 0

  if (hasSearch) {
    el.countUnassigned.textContent = `${unassignedFiltered.length}/${state.board.counts.unassigned}`
    el.countLegion1.textContent = `${legion1Filtered.length}/${state.board.counts.legion1}`
    el.countLegion2.textContent = `${legion2Filtered.length}/${state.board.counts.legion2}`
  } else {
    el.countUnassigned.textContent = String(state.board.counts.unassigned)
    el.countLegion1.textContent = String(state.board.counts.legion1)
    el.countLegion2.textContent = String(state.board.counts.legion2)
  }

  if (el.copyLegion1Btn) {
    el.copyLegion1Btn.disabled = state.board.legion1.length === 0
  }
  if (el.copyLegion2Btn) {
    el.copyLegion2Btn.disabled = state.board.legion2.length === 0
  }

  fillColumn(el.unassignedList, unassignedFiltered, "unassigned")
  fillColumn(el.legion1List, legion1Filtered, "legion1")
  fillColumn(el.legion2List, legion2Filtered, "legion2")
}

async function moveUserToLegion(fid, legion) {
  if (!state.currentEventId) {
    setStatus("Create or select an event first.", "error")
    return
  }

  try {
    await api(`/events/${state.currentEventId}/assign`, {
      method: "POST",
      body: { fid, legion },
    })
    setStatus(`FID ${fid} moved to ${legion}.`, "success")
    await refreshEvents()
    await refreshBoard()
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function unassignFromEvent(fid) {
  if (!state.currentEventId) {
    setStatus("Create or select an event first.", "error")
    return
  }

  try {
    await api(`/events/${state.currentEventId}/members/${fid}`, { method: "DELETE" })
    setStatus(`FID ${fid} unassigned from event.`, "success")
    await refreshEvents()
    await refreshBoard()
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function onUpdateUserRank(fid, rank) {
  try {
    await api(`/users/${fid}/rank`, {
      method: "POST",
      body: { rank },
    })
    setStatus(`FID ${fid} rank updated to ${rank}.`, "success")
    await refreshUsers()
    return true
  } catch (error) {
    const message = safeText(error?.message, "request failed")
    if (message.trim().toLowerCase() === "not found") {
      setStatus("Rank API not found. Restart server and refresh browser.", "error")
      return false
    }
    setStatus(message, "error")
    return false
  }
}

async function onAddSingle() {
  const fid = Number(el.singleFid?.value)
  if (!Number.isInteger(fid) || fid <= 0) {
    setStatus("Enter a valid FID.", "error")
    return
  }

  try {
    await api("/users", { method: "POST", body: { fid } })
    el.singleFid.value = ""
    setStatus(`User ${fid} added.`, "success")
    await refreshAll()
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function onAddBulk() {
  const fids = parseFids(el.bulkFids?.value || "")
  if (fids.length === 0) {
    setStatus("Enter at least one valid FID.", "error")
    return
  }

  setBulkUiBusy(true)
  setBulkProgress({
    visible: true,
    done: 0,
    total: fids.length,
    failed: 0,
    currentFid: null,
  })

  try {
    let totalAdded = 0
    let totalUpdated = 0
    let totalFailed = 0
    const failedFids = []
    const total = fids.length
    const batchSize = 15
    const batchCooldownMs = 5000
    const totalBatches = Math.ceil(total / batchSize)

    for (let i = 0; i < total; i += 1) {
      if (i > 0 && i % batchSize === 0) {
        const completedBatches = Math.floor(i / batchSize)
        setStatus(
          `Batch ${completedBatches}/${totalBatches} complete. Cooling down ${Math.floor(batchCooldownMs / 1000)}s...`,
          "info"
        )
        setBulkProgress({
          visible: true,
          done: i,
          total,
          failed: totalFailed,
          currentFid: null,
          phase: "cooldown",
        })
        await new Promise((resolve) => setTimeout(resolve, batchCooldownMs))
      }

      const fid = fids[i]
      const progressIndex = i + 1
      setStatus(`Bulk queue ${progressIndex}/${total} - FID ${fid}`, "info")
      setBulkProgress({
        visible: true,
        done: i,
        total,
        failed: totalFailed,
        currentFid: fid,
      })

      try {
        const res = await api("/users", { method: "POST", body: { fid } })
        const userStatus = res?.data?.status
        if (userStatus === "added") {
          totalAdded += 1
        } else if (userStatus === "updated") {
          totalUpdated += 1
        } else {
          totalFailed += 1
          failedFids.push(fid)
        }
      } catch (_error) {
        totalFailed += 1
        failedFids.push(fid)
      }

      setBulkProgress({
        visible: true,
        done: progressIndex,
        total,
        failed: totalFailed,
        currentFid: null,
      })
    }

    if (totalFailed === 0) {
      el.bulkFids.value = ""
      setStatus(
        `Bulk done: added ${totalAdded}, updated ${totalUpdated}, failed ${totalFailed}.`,
        "success"
      )
    } else {
      el.bulkFids.value = Array.from(new Set(failedFids)).join("\n")
      const preview = failedFids.slice(0, 10).join(", ")
      const suffix = failedFids.length > 10 ? " ..." : ""
      setStatus(
        `Bulk done: added ${totalAdded}, updated ${totalUpdated}, failed ${totalFailed}. Failed FIDs left in box: ${preview}${suffix}`,
        "error"
      )
    }

    setBulkProgress({
      visible: true,
      done: total,
      total,
      failed: totalFailed,
      currentFid: null,
      phase: "done",
    })

    await refreshAll()
  } catch (error) {
    setBulkProgress({
      visible: true,
      done: 0,
      total: fids.length,
      failed: 0,
      currentFid: null,
      phase: "error",
    })
    setStatus(error.message, "error")
  } finally {
    setBulkUiBusy(false)
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(ms) || 0))
  })
}

function buildGiftErrorMessage(error) {
  const payloadData = error?.payload?.data
  const responseData = payloadData?.response

  let message = safeText(payloadData?.message, "")
  if (!message || message.toLowerCase() === "failed") {
    message = safeText(responseData?.msg, "") || safeText(error?.message, "failed")
  }

  const errCode = payloadData?.err_code ?? responseData?.err_code ?? null
  if (errCode === null || errCode === undefined || errCode === "") {
    return message
  }

  return `${message} (err_code ${errCode})`
}

function normalizeGiftTargets(targetUsers) {
  const list = Array.isArray(targetUsers) ? targetUsers : []
  const normalized = []
  const seen = new Set()

  for (const user of list) {
    const fid = Number(user?.fid)
    if (!Number.isInteger(fid) || fid <= 0 || seen.has(fid)) {
      continue
    }
    seen.add(fid)
    normalized.push({
      fid,
      nickname: safeText(getMemberNickname(user), `FID${fid}`),
    })
  }

  return normalized
}

async function runGiftApplyQueue(targetUsers, sourceLabel) {
  if (state.giftQueueRunning) {
    setStatus("Gift queue is already running.", "error")
    return
  }

  const targets = normalizeGiftTargets(targetUsers)
  if (targets.length === 0) {
    setStatus("No valid target members selected.", "error")
    return
  }

  const codeInfo = resolveGiftCodeToApply()
  if (!codeInfo.ok) {
    setStatus(codeInfo.message, "error")
    return
  }

  const code = codeInfo.code
  if (el.giftApplyCodeInput) {
    el.giftApplyCodeInput.value = code
  }

  state.giftQueueRunning = true
  state.giftFailedFids = []
  renderGiftCodes()

  const total = targets.length
  let success = 0
  let failed = 0
  let queueCrashed = false

  setGiftQueueProgress({
    visible: true,
    done: 0,
    total,
    success: 0,
    failed: 0,
    currentLabel: "",
  })

  try {
    for (let i = 0; i < total; i += 1) {
      if (i > 0 && i % GIFT_QUEUE_COOLDOWN_EVERY === 0) {
        setGiftQueueProgress({
          visible: true,
          done: i,
          total,
          success,
          failed,
          currentLabel: "",
          phase: "cooldown",
        })
        await sleep(GIFT_QUEUE_COOLDOWN_MS)
      }

      const target = targets[i]
      const progress = i + 1
      const currentLabel = `${target.nickname} (FID ${target.fid})`
      setStatus(`Gift queue ${progress}/${total} - ${currentLabel}`, "info")
      setGiftQueueProgress({
        visible: true,
        done: i,
        total,
        success,
        failed,
        currentLabel,
      })

      const entry = {
        fid: target.fid,
        nickname: target.nickname,
        code,
        status: "error",
        message: "failed",
        appliedAt: new Date().toLocaleString(),
      }

      try {
        const res = await api("/gift-codes/redeem", {
          method: "POST",
          body: {
            fid: target.fid,
            cdk: code,
          },
        })

        const status = safeText(res?.data?.status, "success")
        if (status === "success") {
          success += 1
          entry.status = "success"
          entry.message = safeText(res?.data?.response?.msg, "success")
        } else {
          failed += 1
          entry.status = "error"
          entry.message = safeText(res?.data?.message, "failed")
          state.giftFailedFids.push(target.fid)
        }
      } catch (error) {
        failed += 1
        entry.status = "error"
        entry.message = buildGiftErrorMessage(error)
        state.giftFailedFids.push(target.fid)
      }

      state.giftLastResultByFid.set(target.fid, entry)
      state.giftQueueResults.push(entry)
      if (state.giftQueueResults.length > 300) {
        state.giftQueueResults = state.giftQueueResults.slice(-300)
      }
      renderGiftQueueResults()
      renderGiftTargets()

      setGiftQueueProgress({
        visible: true,
        done: progress,
        total,
        success,
        failed,
        currentLabel: "",
      })

      if (progress < total) {
        await sleep(GIFT_QUEUE_REQUEST_DELAY_MS)
      }
    }
  } catch (error) {
    queueCrashed = true
    setGiftQueueProgress({
      visible: true,
      done: success + failed,
      total,
      success,
      failed,
      currentLabel: "",
      phase: "error",
    })
    setStatus(safeText(error?.message, "Gift queue failed."), "error")
  } finally {
    state.giftFailedFids = Array.from(new Set(state.giftFailedFids))
    state.giftQueueRunning = false
    renderGiftCodes()
  }

  if (queueCrashed) {
    return
  }

  setGiftQueueProgress({
    visible: true,
    done: total,
    total,
    success,
    failed,
    currentLabel: "",
    phase: "done",
  })
  setStatus(
    `${sourceLabel} complete. Success ${success}, failed ${failed}.`,
    failed > 0 ? "error" : "success"
  )
}

async function onApplyGiftToSingle(user) {
  await runGiftApplyQueue([user], `Single apply`)
}

async function onApplyGiftToSelected() {
  const targets = getSelectedGiftTargets()
  if (targets.length === 0) {
    setStatus("Select at least one member.", "error")
    return
  }
  await runGiftApplyQueue(targets, `Selected apply`)
}

async function onApplyGiftToAll() {
  if (!Array.isArray(state.users) || state.users.length === 0) {
    setStatus("No registered members to apply.", "error")
    return
  }

  const ok = window.confirm(`Apply current gift code to all ${state.users.length} registered members?`)
  if (!ok) {
    return
  }

  await runGiftApplyQueue(state.users, `Apply to all`)
}

async function onRetryGiftFailed() {
  const targets = getFailedGiftTargets()
  if (targets.length === 0) {
    setStatus("No failed targets to retry.", "error")
    return
  }

  await runGiftApplyQueue(targets, `Retry failed`)
}

async function onAddGiftCode() {
  const normalized = normalizeGiftCodeValue(el.giftCodeInput?.value || "")
  if (!normalized.ok) {
    setStatus(normalized.message, "error")
    return
  }
  const code = normalized.code

  try {
    const res = await api("/gift-codes", {
      method: "POST",
      body: { code },
    })
    const status = safeText(res?.data?.status, "added")
    const savedCode = safeText(res?.data?.gift_code?.code, code)
    if (el.giftCodeInput) {
      el.giftCodeInput.value = ""
    }
    await refreshGiftCodes()
    pickGiftCodeForApply(savedCode)
    setGiftCodeModalOpen(false)

    if (status === "exists") {
      setStatus(`Gift code ${savedCode} already exists.`, "info")
      return
    }

    setStatus(`Gift code ${savedCode} added.`, "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function onDeleteGiftCode(giftCodeId, code) {
  const ok = window.confirm(`Delete gift code ${code}?`)
  if (!ok) {
    return
  }

  try {
    await api(`/gift-codes/${giftCodeId}`, { method: "DELETE" })
    setStatus(`Gift code ${code} deleted.`, "success")
    await refreshGiftCodes()
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function onCreateEvent() {
  const name = (el.eventNameInput?.value || "").trim()
  if (!name) {
    setStatus("Enter an event name.", "error")
    return
  }

  try {
    const res = await api("/events", { method: "POST", body: { name } })
    el.eventNameInput.value = ""
    setEventModalOpen(false)
    state.currentEventId = res.data.id
    setStatus(`Event created: ${res.data.name}`, "success")
    await refreshEvents()
    await refreshBoard()
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function onDeleteEvent() {
  if (!state.currentEventId) {
    setStatus("Select an event first.", "error")
    return
  }

  const event = state.events.find((item) => item.id === state.currentEventId)
  const eventName = event ? event.name : `#${state.currentEventId}`
  const ok = window.confirm(`Delete event ${eventName}? Team assignments in this event will be removed.`)

  if (!ok) {
    return
  }

  try {
    await api(`/events/${state.currentEventId}`, { method: "DELETE" })
    setStatus(`Event ${eventName} deleted.`, "success")
    await refreshEvents()
    await refreshBoard()
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function onClearLegion(legion) {
  if (!state.currentEventId) {
    setStatus("Select an event first.", "error")
    return
  }

  const ok = window.confirm(`Clear all users from ${legion}?`)
  if (!ok) {
    return
  }

  try {
    const res = await api(`/events/${state.currentEventId}/clear-legion`, {
      method: "POST",
      body: { legion },
    })
    setStatus(`Removed ${res.data.removed} users from ${legion}.`, "success")
    await refreshEvents()
    await refreshBoard()
  } catch (error) {
    setStatus(error.message, "error")
  }
}

function bindEvents() {
  el.viewRegisteredBtn?.addEventListener("click", () => setMainView("registered"))
  el.viewShowdownBtn?.addEventListener("click", () => setMainView("showdown"))
  el.viewGiftCodesBtn?.addEventListener("click", () => setMainView("gift-codes"))
  el.addSingleBtn?.addEventListener("click", onAddSingle)
  el.addBulkBtn?.addEventListener("click", onAddBulk)
  el.addGiftCodeBtn?.addEventListener("click", onAddGiftCode)
  el.applyGiftToSelectedBtn?.addEventListener("click", onApplyGiftToSelected)
  el.applyGiftToAllBtn?.addEventListener("click", onApplyGiftToAll)
  el.retryGiftFailedBtn?.addEventListener("click", onRetryGiftFailed)
  el.giftUseSelectedCodeBtn?.addEventListener("click", () => {
    const selectedCode = safeText(el.giftApplyCodeSelect?.value, "").trim()
    const normalized = normalizeGiftCodeValue(selectedCode)
    if (!normalized.ok) {
      setStatus("Select a saved code first.", "error")
      return
    }
    pickGiftCodeForApply(normalized.code)
    setStatus(`Gift code ${normalized.code} selected for apply.`, "info")
  })
  el.giftSelectAllBtn?.addEventListener("click", () => {
    const visibleUsers = getFilteredGiftTargets()
    for (const user of visibleUsers) {
      const fid = Number(user?.fid)
      if (Number.isInteger(fid) && fid > 0) {
        state.giftSelectedFids.add(fid)
      }
    }
    renderGiftTargets()
    setStatus(`${visibleUsers.length} visible members selected.`, "info")
  })
  el.giftClearSelectionBtn?.addEventListener("click", () => {
    state.giftSelectedFids.clear()
    renderGiftTargets()
    setStatus("Gift target selection cleared.", "info")
  })
  el.copyLegion1Btn?.addEventListener("click", () => copyLegionList("legion1"))
  el.copyLegion2Btn?.addEventListener("click", () => copyLegionList("legion2"))
  el.openMemberModalBtn?.addEventListener("click", () => {
    setMemberModalOpen(true)
    el.singleFid?.focus()
  })
  el.closeMemberModalBtn?.addEventListener("click", () => setMemberModalOpen(false))
  el.openEventModalBtn?.addEventListener("click", () => {
    setEventModalOpen(true)
    el.eventNameInput?.focus()
  })
  el.closeEventModalBtn?.addEventListener("click", () => setEventModalOpen(false))
  el.openGiftCodeModalBtn?.addEventListener("click", () => {
    setGiftCodeModalOpen(true)
    el.giftCodeInput?.focus()
  })
  el.closeGiftCodeModalBtn?.addEventListener("click", () => setGiftCodeModalOpen(false))

  el.memberRegModal?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }
    if (target.dataset.closeModal === "true") {
      setMemberModalOpen(false)
    }
  })

  el.eventCreateModal?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }
    if (target.dataset.closeEventModal === "true") {
      setEventModalOpen(false)
    }
  })

  el.giftCodeModal?.addEventListener("click", (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }
    if (target.dataset.closeGiftCodeModal === "true") {
      setGiftCodeModalOpen(false)
    }
  })

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return
    }

    if (!el.giftCodeModal?.classList.contains("hidden")) {
      setGiftCodeModalOpen(false)
      return
    }

    if (!el.eventCreateModal?.classList.contains("hidden")) {
      setEventModalOpen(false)
      return
    }

    if (el.memberRegModal?.classList.contains("hidden")) {
      return
    }
    setMemberModalOpen(false)
  })

  el.createEventBtn?.addEventListener("click", onCreateEvent)
  el.deleteEventBtn?.addEventListener("click", onDeleteEvent)

  el.clearLegion1Btn?.addEventListener("click", () => onClearLegion("legion1"))
  el.clearLegion2Btn?.addEventListener("click", () => onClearLegion("legion2"))

  el.refreshBtn?.addEventListener("click", async () => {
    const refreshButton = el.refreshBtn
    if (refreshButton) {
      refreshButton.disabled = true
    }

    try {
      await refreshUsers()
      const fids = Array.from(
        new Set(
          (Array.isArray(state.users) ? state.users : [])
            .map((user) => Number(user?.fid))
            .filter((fid) => Number.isInteger(fid) && fid > 0)
        )
      )

      const total = fids.length
      if (total === 0) {
        setStatus("등록된 멤버가 없어서 동기화할 대상이 없습니다.", "info")
        return
      }

      let added = 0
      let updated = 0
      let failed = 0
      const failedFids = []
      const requestDelayMs = 350

      for (let index = 0; index < total; index += 1) {
        const fid = fids[index]
        const progress = index + 1
        setStatus(`전체인원 동기화 ${progress}/${total} (FID ${fid})`, "info")

        try {
          const res = await api("/users", { method: "POST", body: { fid } })
          const userStatus = safeText(res?.data?.status, "").toLowerCase()
          if (userStatus === "added") {
            added += 1
          } else if (userStatus === "updated") {
            updated += 1
          } else {
            failed += 1
            failedFids.push(fid)
          }
        } catch (_error) {
          failed += 1
          failedFids.push(fid)
        }

        if (index < total - 1) {
          await new Promise((resolve) => setTimeout(resolve, requestDelayMs))
        }
      }

      await refreshAll()

      if (failed > 0) {
        const preview = failedFids.slice(0, 8).join(", ")
        const suffix = failedFids.length > 8 ? " ..." : ""
        setStatus(
          `동기화 완료 ${total}/${total} | updated ${updated}, added ${added}, failed ${failed} (${preview}${suffix})`,
          "error"
        )
        return
      }

      setStatus(
        `동기화 완료 ${total}/${total} | updated ${updated}, added ${added}, failed ${failed}`,
        "success"
      )
    } catch (error) {
      setStatus(error.message, "error")
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false
      }
    }
  })

  el.memberSearchInput?.addEventListener("input", () => {
    state.boardSearch = safeText(el.memberSearchInput.value || "", "")
    renderBoard()
  })

  el.registeredSearchInput?.addEventListener("input", () => {
    state.registeredSearch = safeText(el.registeredSearchInput.value || "", "")
    renderRegisteredUsers()
  })

  el.giftApplySearchInput?.addEventListener("input", () => {
    state.giftApplySearch = safeText(el.giftApplySearchInput.value || "", "")
    renderGiftTargets()
  })

  el.giftApplyCodeSelect?.addEventListener("change", () => {
    const selectedCode = safeText(el.giftApplyCodeSelect?.value, "").trim()
    if (!selectedCode) {
      return
    }
    if (!safeText(el.giftApplyCodeInput?.value, "").trim()) {
      pickGiftCodeForApply(selectedCode)
    }
  })

  el.eventSelect?.addEventListener("change", async (event) => {
    const value = Number(event.target.value)
    state.currentEventId = Number.isInteger(value) && value > 0 ? value : null

    try {
      await refreshBoard()
      setStatus("Event changed.", "info")
    } catch (error) {
      setStatus(error.message, "error")
    }
  })

  el.singleFid?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onAddSingle()
    }
  })

  el.eventNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onCreateEvent()
    }
  })

  el.giftCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onAddGiftCode()
    }
  })

  el.giftApplyCodeInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onApplyGiftToSelected()
    }
  })

  el.giftApplySearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      onApplyGiftToSelected()
    }
  })
}

async function init() {
  bindEvents()
  setMainView("registered")
  setMemberModalOpen(false)
  setEventModalOpen(false)
  setGiftCodeModalOpen(false)
  state.registeredSearch = safeText(el.registeredSearchInput?.value || "", "")
  state.boardSearch = safeText(el.memberSearchInput?.value || "", "")
  state.giftApplySearch = safeText(el.giftApplySearchInput?.value || "", "")
  setBulkProgress({
    visible: false,
    done: 0,
    total: 0,
  })
  setGiftQueueProgress({
    visible: false,
    done: 0,
    total: 0,
    success: 0,
    failed: 0,
  })

  try {
    await refreshAll()
    setStatus("Ready.", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

init()


