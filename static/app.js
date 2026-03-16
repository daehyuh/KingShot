const state = {
  users: [],
  events: [],
  currentEventId: null,
  board: null,
  registeredCollapsed: true,
  memberSearch: "",
}

const el = {
  statusBar: document.getElementById("statusBar"),
  singleFid: document.getElementById("singleFid"),
  bulkFids: document.getElementById("bulkFids"),
  bulkProgress: document.getElementById("bulkProgress"),
  bulkProgressText: document.getElementById("bulkProgressText"),
  bulkProgressMeta: document.getElementById("bulkProgressMeta"),
  bulkProgressFill: document.getElementById("bulkProgressFill"),
  bulkProgressDetail: document.getElementById("bulkProgressDetail"),
  addSingleBtn: document.getElementById("addSingleBtn"),
  addBulkBtn: document.getElementById("addBulkBtn"),
  toggleRegisteredBtn: document.getElementById("toggleRegisteredBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  registeredUsersWrap: document.getElementById("registeredUsersWrap"),
  registeredUsers: document.getElementById("registeredUsers"),
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
}

function setStatus(message, type = "info") {
  if (!el.statusBar) {
    return
  }
  el.statusBar.textContent = message
  el.statusBar.dataset.type = type
}

function setRegisteredCollapsed(collapsed) {
  state.registeredCollapsed = !!collapsed

  if (!el.registeredUsersWrap || !el.toggleRegisteredBtn) {
    return
  }

  if (state.registeredCollapsed) {
    el.registeredUsersWrap.classList.add("hidden")
    el.toggleRegisteredBtn.textContent = "Expand"
  } else {
    el.registeredUsersWrap.classList.remove("hidden")
    el.toggleRegisteredBtn.textContent = "Collapse"
  }
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

function normalizeSearchText(value) {
  return normalizeMemberName(value)
    .toLowerCase()
}

function getSearchTerms() {
  const raw = safeText(state.memberSearch, "")
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

function filterMembersBySearch(users, terms = getSearchTerms()) {
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
  return `${title}\n- ${names.join(", ")}`
}

async function copyLegionList(legionKey) {
  if (!state.board) {
    setStatus("Select an event first.", "error")
    return
  }

  const users = legionKey === "legion1" ? state.board.legion1 : state.board.legion2
  const title = legionKey === "legion1" ? "Legion1" : "Legion2"

  if (!users || users.length === 0) {
    setStatus(`${title} has no members to copy.`, "error")
    return
  }

  try {
    await copyText(buildLegionCopyText(title, users))
    setStatus(`${title} list copied (${users.length}).`, "success")
  } catch (_error) {
    setStatus(`Could not copy ${title} list.`, "error")
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
    throw new Error(payload.msg || `Request failed (${response.status})`)
  }

  return payload
}

async function refreshUsers() {
  const res = await api("/users")
  state.users = Array.isArray(res.data) ? res.data : []
  renderRegisteredUsers()
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

async function refreshAll() {
  await refreshUsers()
  await refreshEvents()
  await refreshBoard()
}

function renderRegisteredUsers() {
  if (!el.registeredUsers) {
    return
  }

  el.registeredUsers.innerHTML = ""

  if (state.users.length === 0) {
    el.registeredUsers.innerHTML = `<div class="empty">No registered members yet.</div>`
    return
  }

  const searchTerms = getSearchTerms()
  const filteredUsers = filterMembersBySearch(state.users, searchTerms)
  if (filteredUsers.length === 0) {
    el.registeredUsers.innerHTML = `<div class="empty">No matching member.</div>`
    return
  }

  for (const user of filteredUsers) {
    const row = document.createElement("div")
    row.className = "user-row"

    const info = document.createElement("div")
    const nickname = safeText(getMemberNickname(user), "Unknown")
    info.innerHTML = `
      <div class="name">${nickname}</div>
      <div class="meta">FID ${safeText(user.fid)} | KID ${safeText(user.kid)} | Town Center ${safeText(user.stove_lv)}</div>
    `

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

    row.appendChild(info)
    row.appendChild(removeBtn)
    el.registeredUsers.appendChild(row)
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

  card.innerHTML = `
    <p class="title">${nickname}</p>
    <p class="sub">FID ${fid} | Town Center ${stove}</p>
    <div class="actions"></div>
  `

  const actions = card.querySelector(".actions")

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
  el.boardMeta.textContent = `Event #${state.board.event.id} created at ${state.board.event.created_at}`

  const searchTerms = getSearchTerms()
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

async function onCreateEvent() {
  const name = (el.eventNameInput?.value || "").trim()
  if (!name) {
    setStatus("Enter an event name.", "error")
    return
  }

  try {
    const res = await api("/events", { method: "POST", body: { name } })
    el.eventNameInput.value = ""
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
  el.addSingleBtn?.addEventListener("click", onAddSingle)
  el.addBulkBtn?.addEventListener("click", onAddBulk)
  el.copyLegion1Btn?.addEventListener("click", () => copyLegionList("legion1"))
  el.copyLegion2Btn?.addEventListener("click", () => copyLegionList("legion2"))

  el.toggleRegisteredBtn?.addEventListener("click", () => {
    setRegisteredCollapsed(!state.registeredCollapsed)
  })

  el.createEventBtn?.addEventListener("click", onCreateEvent)
  el.deleteEventBtn?.addEventListener("click", onDeleteEvent)

  el.clearLegion1Btn?.addEventListener("click", () => onClearLegion("legion1"))
  el.clearLegion2Btn?.addEventListener("click", () => onClearLegion("legion2"))

  el.refreshBtn?.addEventListener("click", async () => {
    try {
      await refreshAll()
      setStatus("Data refreshed.", "success")
    } catch (error) {
      setStatus(error.message, "error")
    }
  })

  el.memberSearchInput?.addEventListener("input", () => {
    state.memberSearch = el.memberSearchInput.value || ""
    renderRegisteredUsers()
    renderBoard()
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
}

async function init() {
  bindEvents()
  setRegisteredCollapsed(true)
  setBulkProgress({
    visible: false,
    done: 0,
    total: 0,
  })

  try {
    await refreshAll()
    setStatus("Ready.", "success")
  } catch (error) {
    setStatus(error.message, "error")
  }
}

init()
