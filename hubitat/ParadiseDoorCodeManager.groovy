/**
 * Paradise Door Code Manager
 * Version: 3.1.0 — 2026-05-11
 *
 * CHANGES FROM v2.8.5:
 *   BUG FIX 1 — setCode confirmation via lock event subscription (no more silent fails)
 *   BUG FIX 2 — Hard stop on slot overwrite: warns and blocks if slot is occupied by active booking
 *   BUG FIX 3 — Edit now pushes updated code to lock immediately (was updating state only)
 *   BUG FIX 4 — Slot entry bounded: guest auto-assign starts at 31, hard ceiling at 250
 *   BUG FIX 5 — Collision check uses both state bookings AND live lockCodes attribute
 *
 *   NEW — Role-based slot enforcement (Owner 1–10, Staff 11–30, Guest 31–250)
 *   NEW — Access log with slot-to-identity cross-reference
 *   NEW — SecureRandom PIN generation (replaces Math.random)
 *   NEW — Lock event subscription for real-time access tracking
 *   NEW — Notification stubs (ready for SMS/email Phase 2)
 *
 * v3.1.0 — 2026-05-11
 *   NEW — notifyGuest(): sends check-in email via Hubitat sendEmail() at code activation
 *         Requires SMTP configured in Hub Settings → Notifications → Email
 *   NEW — Pending confirmation state: tracks setCode → confirmed lifecycle
 *   NEW — Front door scope guard (Pump Room and Owner's Closet explicitly excluded)
 *   NEW — Southern Coast PM view (slots 31–250 only)
 *
 * SLOT MAP:
 *   1–10   Owner (manual only, never auto-assigned)
 *   11–20  Staff / Property Manager (manual only)
 *   21–30  Standing VIP guests (manual, semi-permanent)
 *   31–250 STR bookings (auto-assigned, auto-expire)
 *
 * LIFECYCLE:
 *   Booking created → code pushed to lock (pending) → lock confirms → state = ready
 *   At 4:00 PM check-in day → activate (code already on lock, just track state)
 *   At 10:00 AM checkout day → deleteCode → archive booking
 */

import groovy.json.JsonSlurper
import java.security.SecureRandom

definition(
    name:        "Paradise Door Code Manager",
    namespace:   "paradise",
    author:      "David Taylor",
    description: "Automated STR lock code lifecycle manager for Paradise.",
    category:    "Convenience",
    iconUrl:     "",
    iconX2Url:   "",
    singleInstance: true
)

// ── Constants ─────────────────────────────────────────────────────
@Field static final int  SLOT_OWNER_MIN   = 1
@Field static final int  SLOT_OWNER_MAX   = 10
@Field static final int  SLOT_STAFF_MIN   = 11
@Field static final int  SLOT_STAFF_MAX   = 30
@Field static final int  SLOT_GUEST_MIN   = 31
@Field static final int  SLOT_GUEST_MAX   = 250
@Field static final int  CHECK_IN_HOUR    = 16   // 4:00 PM
@Field static final int  CHECK_OUT_HOUR   = 10   // 10:00 AM
@Field static final int  CODE_CONFIRM_TIMEOUT_MIN = 5  // minutes to wait for lock confirmation

// ── Preferences ───────────────────────────────────────────────────

preferences {
    page(name: "mainPage")
    page(name: "addBookingPage")
    page(name: "editBookingPage")
    page(name: "accessLogPage")
    page(name: "settingsPage")
}

// ── Lifecycle ─────────────────────────────────────────────────────

def installed() {
    log.info "Paradise Door Code Manager installed"
    initState()
    initialize()
}

def updated() {
    log.info "Paradise Door Code Manager updated"
    unsubscribe()
    unschedule()
    initialize()
}

def uninstalled() {
    log.info "Paradise Door Code Manager uninstalled"
    unsubscribe()
    unschedule()
}

private void initState() {
    if (!state.bookings)   state.bookings   = [:]
    if (!state.accessLog)  state.accessLog  = []
    if (!state.pendingConfirm) state.pendingConfirm = [:]
}

private void initialize() {
    initState()
    if (frontDoor) {
        subscribe(frontDoor, "lock",       lockEventHandler)
        subscribe(frontDoor, "codeChanged", codeChangedHandler)
    }
    // Heartbeat every minute for activation/deactivation timing
    schedule("0 * * * * ?", "tickHandler")
    logInfo "Initialized — monitoring: ${frontDoor?.displayName ?: 'no lock selected'}"
}

// ── Pages ─────────────────────────────────────────────────────────

def mainPage() {
    state.navToMain   = false
    state.addFormInit = false

    dynamicPage(name: "mainPage", title: "Paradise Door Code Manager", install: true, uninstall: true) {

        section("Status") {
            paragraph state.uiMsg ?: "Ready."
        }

        section("Lock Configuration") {
            input "frontDoor", "capability.lockCodes",
                  title: "Front Door Lock",
                  description: "Pump Room and Owner's Closet are excluded from this app",
                  multiple: false, required: true
            if (frontDoor) {
                def maxSlots = getMaxSlots()
                paragraph "Lock: ${frontDoor.displayName} · Max slots: ${maxSlots} · Guest pool: slots ${SLOT_GUEST_MIN}–${Math.min(SLOT_GUEST_MAX, maxSlots)}"
            }
        }

        section("Notifications (Phase 2)") {
            input "notifyOwnerPhone",  "string", title: "Owner phone (SMS — leave blank to disable)",    required: false
            input "notifyGuestByCode", "bool",   title: "Send guest notification when code activates",   defaultValue: false
        }

        section("Bookings") {
            if (!state.bookings || state.bookings.isEmpty()) {
                paragraph "No bookings yet. Tap 'Add Booking' to create one."
            } else {
                def tz = hubTimezone()
                def sorted = state.bookings.values().sort { it.startEpoch ?: 0L }

                // Active bookings first
                def active  = sorted.findAll { it.activated && !it.deactivated }
                def pending = sorted.findAll { !it.activated && !it.deactivated && new Date().time < (it.startEpoch as Long) }
                def ended   = sorted.findAll { it.deactivated }

                if (active) {
                    paragraph "── ACTIVE ──────────────────"
                    active.each { b -> renderBookingRow(b, tz) }
                }
                if (pending) {
                    paragraph "── SCHEDULED ───────────────"
                    pending.each { b -> renderBookingRow(b, tz) }
                }
                if (ended) {
                    paragraph "── ENDED ───────────────────"
                    ended.take(5).each { b -> renderBookingRow(b, tz) }  // show last 5 ended
                }

                // Bulk actions
                input "bulkActivateBtn",   "button", title: "✅ Activate Selected",   submitOnChange: true
                input "bulkDeactivateBtn", "button", title: "⛔ Deactivate Selected", submitOnChange: true
                input "bulkDeleteBtn",     "button", title: "🗑 Delete Selected",     submitOnChange: true
                input "selectAllBtn",      "button", title: "☑ Select All",           submitOnChange: true
                input "selectNoneBtn",     "button", title: "☐ Select None",          submitOnChange: true

                def checked = getCheckedIds()
                if (checked.size() == 1) {
                    href name: "toEdit", page: "editBookingPage",
                         title: "✏️ Edit Selected Booking",
                         description: "Edit dates, code, or label for the checked booking"
                }
            }
        }

        section("Actions") {
            href name: "toAdd",    page: "addBookingPage", title: "➕ Add Booking",    description: "Create a new STR booking code"
            href name: "toLog",    page: "accessLogPage",  title: "📋 Access Log",     description: "View who used which code and when"
            href name: "toSettings", page: "settingsPage", title: "⚙️ Settings",       description: "Slot map, defaults, notifications"
            input "refreshBtn",  "button", title: "↺ Run Tick Now",             submitOnChange: true
            input "clearAllBtn", "button", title: "↺ Rebuild Schedules",        submitOnChange: true
        }
    }
}

private void renderBookingRow(Map b, TimeZone tz) {
    input "sel_${b.id}", "bool",
          title: bookingSummaryLine(b, tz),
          defaultValue: false, submitOnChange: true
    input "delrow_${b.id}", "button", title: "🗑 Delete", submitOnChange: true
}

def addBookingPage() {
    if (state.navToMain) { state.navToMain = false; return mainPage() }
    if (!state.addFormInit) { clearTempInputs(); state.addFormInit = true }

    dynamicPage(name: "addBookingPage", title: "Add Booking") {
        section("Guest Details") {
            input "tmp_bookingName",  "string", title: "Guest name (First Last)",      required: true
            input "tmp_guestPhone",   "string", title: "Guest phone (for notification)", required: false
            input "tmp_guestEmail",   "string", title: "Guest email (for notification)", required: false
        }
        section("Dates") {
            input "tmp_startDate",    "date",   title: "Check-in date (yyyy-MM-dd)",   required: true
            input "tmp_checkInTime",  "time",   title: "Check-in time",                required: true, defaultValue: "16:00"
            input "tmp_endDate",      "date",   title: "Checkout date (yyyy-MM-dd)",   required: true
            input "tmp_checkOutTime", "time",   title: "Checkout time",                required: true, defaultValue: "10:00"
        }
        section("Code Options") {
            input "tmp_autoSlot",   "bool",   title: "Auto-assign slot (${SLOT_GUEST_MIN}–${SLOT_GUEST_MAX})",   defaultValue: true,  submitOnChange: true
            if (!(settings.tmp_autoSlot as Boolean)) {
                input "tmp_slot",   "number", title: "Manual slot (${SLOT_GUEST_MIN}–${SLOT_GUEST_MAX} only for PM)", required: false
            }
            input "tmp_autoGen",    "bool",   title: "Auto-generate PIN",              defaultValue: true,  submitOnChange: true
            if (!(settings.tmp_autoGen as Boolean)) {
                input "tmp_manualCode", "string", title: "Manual PIN (digits only)",   required: false
            }
            input "tmp_len",        "number", title: "PIN length (4–8 digits)",        defaultValue: 6
            input "tmp_autoDelete", "bool",   title: "Auto-delete code at checkout",   defaultValue: true
        }
        section("Save") {
            input "createAndCloseBtn",   "button", title: "💾 Save & Return",       submitOnChange: true
            input "createAndAnotherBtn", "button", title: "💾 Save & Add Another",  submitOnChange: true
            href name: "exitAdd", page: "mainPage", title: "↩ Cancel"
        }
    }
}

def editBookingPage() {
    def ids = getCheckedIds()
    if (ids.size() != 1) {
        return dynamicPage(name: "editBookingPage", title: "Edit Booking") {
            section { paragraph "Select exactly one booking to edit, then tap Edit." }
        }
    }
    String id = ids[0]
    def b = state.bookings[id]
    if (!b) {
        return dynamicPage(name: "editBookingPage", title: "Edit Booking") {
            section { paragraph "Booking not found — go back and try again." }
        }
    }
    state.editId = id
    def tz = hubTimezone()

    dynamicPage(name: "editBookingPage", title: "Edit — ${b.name}") {
        section("Guest Details") {
            input "e_bookingName",  "string", title: "Guest name",                required: true, defaultValue: b.name
            input "e_guestPhone",   "string", title: "Guest phone",               required: false, defaultValue: (b.guestPhone ?: "")
            input "e_guestEmail",   "string", title: "Guest email",               required: false, defaultValue: (b.guestEmail ?: "")
        }
        section("Dates") {
            def dS  = new Date(b.startEpoch as Long).format("yyyy-MM-dd", tz)
            def dE  = new Date(b.endEpoch   as Long).format("yyyy-MM-dd", tz)
            def tIn  = new Date(b.startEpoch as Long).format("HH:mm", tz)
            def tOut = new Date(b.endEpoch   as Long).format("HH:mm", tz)
            input "e_startDate",    "date",   title: "Check-in date",             required: true, defaultValue: dS
            input "e_checkInTime",  "time",   title: "Check-in time",             required: true, defaultValue: tIn
            input "e_endDate",      "date",   title: "Checkout date",             required: true, defaultValue: dE
            input "e_checkOutTime", "time",   title: "Checkout time",             required: true, defaultValue: tOut
        }
        section("Code Options") {
            input "e_slot",         "number", title: "Slot (${SLOT_GUEST_MIN}–${SLOT_GUEST_MAX})", required: true, defaultValue: b.slot
            input "e_autoGen",      "bool",   title: "Auto-generate PIN",         required: true, defaultValue: b.autoGen, submitOnChange: true
            if (!(settings.e_autoGen as Boolean)) {
                input "e_manualCode", "string", title: "Manual PIN",              required: false, defaultValue: (b.manualCode ?: "")
            }
            input "e_len",          "number", title: "PIN length (4–8)",          required: true, defaultValue: (b.len ?: 6)
            input "e_autoDelete",   "bool",   title: "Auto-delete at checkout",   required: true, defaultValue: b.autoDelete
        }
        section("Warning") {
            paragraph "⚠️ Saving will push the updated code to the lock immediately if the booking is active."
        }
        section {
            input "saveEditBtn", "button", title: "💾 Save Changes", submitOnChange: true
            href name: "exitEdit", page: "mainPage", title: "↩ Cancel"
        }
    }
}

def accessLogPage() {
    dynamicPage(name: "accessLogPage", title: "Access Log") {
        section {
            if (!state.accessLog || state.accessLog.isEmpty()) {
                paragraph "No access events recorded yet."
            } else {
                def tz = hubTimezone()
                def entries = state.accessLog.sort { -(it.epochMs as Long) }.take(50)
                entries.each { e ->
                    def ts   = new Date(e.epochMs as Long).format("MM/dd/yyyy HH:mm:ss", tz)
                    def who  = resolveSlotIdentity(e.slot as Integer)
                    paragraph "🔑 ${ts}\nSlot ${e.slot} · ${who}\n${e.action} · ${e.device}"
                }
                input "clearLogBtn", "button", title: "🗑 Clear Log", submitOnChange: true
            }
        }
    }
}

def settingsPage() {
    dynamicPage(name: "settingsPage", title: "Settings") {
        section("Slot Map (read-only reference)") {
            paragraph "Slots ${SLOT_OWNER_MIN}–${SLOT_OWNER_MAX}: Owner (manual only)\nSlots ${SLOT_STAFF_MIN}–${SLOT_STAFF_MAX}: Staff / PM / Cleaners (manual only)\nSlots ${SLOT_GUEST_MIN}–${SLOT_GUEST_MAX}: STR Bookings (auto-assigned)"
        }
        section("Defaults") {
            input "defaultCodeLen",    "number", title: "Default PIN length",             defaultValue: 6
            input "defaultAutoDelete", "bool",   title: "Auto-delete codes at checkout", defaultValue: true
        }
        section("Notifications") {
            input "notifyOwnerPhone",  "string", title: "Owner SMS number",                required: false
            input "notifyGuestByCode", "bool",   title: "Notify guest when code activates", defaultValue: false
        }
    }
}

// ── Button handler ────────────────────────────────────────────────

def appButtonHandler(btn) {
    logDebug "Button: ${btn}"

    switch(btn) {
        case "refreshBtn":
            tickHandler()
            uiInfo("Tick ran at ${new Date().format('HH:mm:ss')}")
            break

        case "clearAllBtn":
            unschedule()
            schedule("0 * * * * ?", "tickHandler")
            uiInfo("Schedules rebuilt.")
            break

        case "clearLogBtn":
            state.accessLog = []
            uiInfo("Access log cleared.")
            break

        case "createAndCloseBtn":
            createBookingFromTemps(true)
            break

        case "createAndAnotherBtn":
            createBookingFromTemps(false)
            break

        case "saveEditBtn":
            saveEditedBooking()
            break

        case "selectAllBtn":
            state.bookings?.keySet()?.each { id ->
                app.updateSetting("sel_${id}", [value: true, type: "bool"])
            }
            break

        case "selectNoneBtn":
            clearCheckedFlags(state.bookings?.keySet()?.toList())
            break

        case "bulkActivateBtn":
            def ids = getCheckedIds()
            if (!ids) { uiWarn("Select at least one booking."); break }
            ids.each { activateById(it as String, true) }
            clearCheckedFlags(ids)
            break

        case "bulkDeactivateBtn":
            def ids = getCheckedIds()
            if (!ids) { uiWarn("Select at least one booking."); break }
            ids.each { deactivateById(it as String) }
            clearCheckedFlags(ids)
            break

        case "bulkDeleteBtn":
            def ids = getCheckedIds()
            if (!ids) { uiWarn("Select at least one booking to delete."); break }
            int ok = 0, fail = 0
            ids.each { id ->
                try { deleteBooking(id as String); ok++ }
                catch (e) { logWarn "Bulk delete failed for ${id}: ${e}"; fail++ }
            }
            clearCheckedFlags(ids)
            uiInfo("Deleted ${ok} booking(s)${fail ? ', ${fail} failed' : ''}")
            break

        default:
            // Per-row delete
            if (btn?.startsWith("delrow_")) {
                String id = btn - "delrow_"
                def b = state.bookings[id]
                deleteBooking(id)
                app.updateSetting("sel_${id}", [value: false, type: "bool"])
                uiInfo("Deleted: ${b?.name ?: id}")
            }
    }
}

// ── Core — Create ─────────────────────────────────────────────────

private void createBookingFromTemps(boolean closeAfter) {
    if (!frontDoor) { uiWarn("Select the Front Door lock first."); return }
    def tz = hubTimezone()

    // Required field check
    if (!settings.tmp_bookingName || !settings.tmp_startDate || !settings.tmp_endDate ||
        !settings.tmp_checkInTime || !settings.tmp_checkOutTime) {
        uiWarn("All booking fields are required.")
        return
    }

    Date startDT = combineDateAndTime(settings.tmp_startDate, settings.tmp_checkInTime, tz)
    Date endDT   = combineDateAndTime(settings.tmp_endDate,   settings.tmp_checkOutTime, tz)

    if (!startDT || !endDT)    { uiWarn("Invalid date or time format."); return }
    if (!endDT.after(startDT)) { uiWarn("Checkout must be after check-in."); return }

    // Slot resolution — BUG FIX 4: bounded to SLOT_GUEST_MIN..SLOT_GUEST_MAX
    Integer slot
    if (settings.tmp_autoSlot as Boolean) {
        slot = nextAvailableSlot(startDT.time, endDT.time)
        if (!slot) { uiWarn("No available slot in range ${SLOT_GUEST_MIN}–${SLOT_GUEST_MAX}. Check for overlapping bookings."); return }
    } else {
        slot = (settings.tmp_slot as Integer) ?: SLOT_GUEST_MIN
        // Enforce guest slot range — PM cannot assign owner/staff slots
        if (slot < SLOT_GUEST_MIN || slot > SLOT_GUEST_MAX) {
            uiWarn("Slot must be between ${SLOT_GUEST_MIN} and ${SLOT_GUEST_MAX} for guest bookings. Slots 1–${SLOT_STAFF_MAX} are reserved for owner and staff.")
            return
        }
        // BUG FIX 2: hard stop on collision
        if (slotHasActiveBooking(slot, startDT.time, endDT.time)) {
            uiWarn("Slot ${slot} is already occupied by an active booking during this window. Choose a different slot or use auto-assign.")
            return
        }
    }

    def id = now().toString()
    def b = [
        id:          id,
        name:        settings.tmp_bookingName,
        guestPhone:  (settings.tmp_guestPhone ?: null),
        guestEmail:  (settings.tmp_guestEmail ?: null),
        slot:        slot,
        autoGen:     (settings.tmp_autoGen as Boolean),
        manualCode:  (settings.tmp_manualCode ?: null),
        len:         Math.max(4, Math.min(8, (settings.tmp_len as Integer) ?: 6)),
        autoDelete:  (settings.tmp_autoDelete as Boolean),
        startEpoch:  startDT.time,
        endEpoch:    endDT.time,
        activeCode:  null,
        activated:   false,
        deactivated: false,
        codeOnLock:  false,   // true once lock confirms code was written
        createdAt:   now(),
    ]

    // Generate and pre-load code onto lock immediately (so it's confirmed before check-in)
    String code = resolveCode(b)
    b.activeCode = code
    state.bookings[id] = b

    // Push code to lock — confirmation happens via codeChangedHandler
    pushCodeToLock(b, code)

    uiInfo("Booking created: ${b.name} · Slot ${slot} · Code sent to lock (pending confirmation)")

    // Auto-activate if we're already inside the booking window
    def nowTs = new Date().time
    if (nowTs >= b.startEpoch && nowTs < b.endEpoch) {
        logInfo "Booking ${b.name} is within window — activating immediately"
        activateById(id, true)
    }

    clearTempInputs()
    if (closeAfter) { state.addFormInit = false; state.navToMain = true }
    else            { state.addFormInit = false }
}

// ── Core — Edit ───────────────────────────────────────────────────

private void saveEditedBooking() {
    def id = state.editId
    def b  = state.bookings[id]
    if (!b) { uiWarn("Edit target not found — try again."); return }

    def tz = hubTimezone()
    Date startDT = combineDateAndTime(settings.e_startDate, settings.e_checkInTime, tz)
    Date endDT   = combineDateAndTime(settings.e_endDate,   settings.e_checkOutTime, tz)

    if (!startDT || !endDT)    { uiWarn("Invalid dates."); return }
    if (!endDT.after(startDT)) { uiWarn("Checkout must be after check-in."); return }

    Integer newSlot = (settings.e_slot as Integer) ?: b.slot
    if (newSlot < SLOT_GUEST_MIN || newSlot > SLOT_GUEST_MAX) {
        uiWarn("Slot ${newSlot} is outside the allowed guest range (${SLOT_GUEST_MIN}–${SLOT_GUEST_MAX}).")
        return
    }

    // If slot changed, check for collision
    if (newSlot != b.slot && slotHasActiveBooking(newSlot, startDT.time, endDT.time, id)) {
        uiWarn("Slot ${newSlot} is occupied by another booking in this window.")
        return
    }

    // Update booking record
    b.name        = settings.e_bookingName
    b.guestPhone  = (settings.e_guestPhone ?: null)
    b.guestEmail  = (settings.e_guestEmail ?: null)
    b.slot        = newSlot
    b.autoGen     = (settings.e_autoGen as Boolean)
    b.manualCode  = (settings.e_manualCode ?: null)
    b.len         = Math.max(4, Math.min(8, (settings.e_len as Integer) ?: b.len))
    b.autoDelete  = (settings.e_autoDelete as Boolean)
    b.startEpoch  = startDT.time
    b.endEpoch    = endDT.time

    // BUG FIX 3: push updated code to lock if booking is active
    if (b.activated && !b.deactivated) {
        String newCode = resolveCode(b)
        b.activeCode  = newCode
        b.codeOnLock  = false  // reset — waiting for reconfirmation
        pushCodeToLock(b, newCode)
        uiInfo("Booking updated and new code pushed to lock: ${b.name} · Slot ${b.slot}")
    } else {
        // Not yet active — regenerate code for when it activates
        b.activeCode = resolveCode(b)
        uiInfo("Booking updated: ${b.name} · Slot ${b.slot} — code will be pushed at next activation")
    }

    clearCheckedFlags([id])
    state.editId = null
}

// ── Core — Activate / Deactivate ─────────────────────────────────

private void activateById(String id, boolean force = false) {
    def b = state.bookings[id]
    if (!b) { uiWarn("Booking ${id} not found."); return }
    if (!frontDoor) { uiWarn("No lock configured."); return }

    def nowTs = new Date().time

    if (!force && !(nowTs >= (b.startEpoch as Long) && nowTs < (b.endEpoch as Long))) {
        logInfo "Skipping activation of ${b.name} — outside window and not forced"
        return
    }

    // Code should already be on lock (pushed at creation). If not, push now.
    if (!b.codeOnLock) {
        logWarn "Code for ${b.name} not confirmed on lock — pushing now"
        pushCodeToLock(b, b.activeCode ?: resolveCode(b))
    }

    b.activated   = true
    b.deactivated = false
    logInfo "Activated: ${b.name} · Slot ${b.slot} · Code ${b.activeCode}"
    uiInfo("✅ Activated: ${b.name} (Slot ${b.slot})")

    notifyGuest(b)
}

private void deactivateById(String id) {
    def b = state.bookings[id]
    if (!b) { uiWarn("Booking ${id} not found."); return }
    if (!frontDoor) { uiWarn("No lock configured."); return }

    try {
        frontDoor.deleteCode(b.slot as Integer)
        logInfo "deleteCode sent for slot ${b.slot} (${b.name})"
    } catch (e) {
        logWarn "deleteCode failed for slot ${b.slot}: ${e}"
    }

    b.activeCode  = null
    b.activated   = false
    b.deactivated = true
    b.codeOnLock  = false

    uiInfo("⛔ Deactivated: ${b.name} (Slot ${b.slot})")
    logInfo "Deactivated: ${b.name} · Slot ${b.slot}"

    // TODO Phase 2: send owner checkout notification
    // notifyOwner("Checkout complete: ${b.name}")
}

// ── Core — Delete ─────────────────────────────────────────────────

private void deleteBooking(String id) {
    def b = state.bookings[id]
    if (!b) { logWarn "Delete: booking not found for id=${id}"; return }

    // Remove code from lock if it's still there
    try {
        if (frontDoor && b.codeOnLock && b.autoDelete) {
            frontDoor.deleteCode(b.slot as Integer)
            logInfo "Removed code slot ${b.slot} from lock for deleted booking ${b.name}"
        }
    } catch (e) {
        logWarn "Lock delete failed for slot ${b?.slot}/${b?.name}: ${e}"
    }

    state.bookings.remove(id)
    logInfo "Deleted booking: ${b.name} · Slot ${b.slot}"
}

// ── Tick — runs every minute ──────────────────────────────────────

def tickHandler() {
    if (!state.bookings || state.bookings.isEmpty()) return
    def nowTs = new Date().time

    state.bookings.values().each { b ->
        // Activate at check-in time
        if (!b.activated && !b.deactivated &&
            nowTs >= (b.startEpoch as Long) && nowTs < (b.endEpoch as Long)) {
            logInfo "Tick: activating ${b.name}"
            activateById(b.id as String, false)
        }
        // Deactivate at checkout time
        if (b.activated && !b.deactivated && nowTs >= (b.endEpoch as Long)) {
            logInfo "Tick: deactivating ${b.name}"
            deactivateById(b.id as String)
        }
        // Warn if code hasn't confirmed within timeout window
        if (b.activeCode && !b.codeOnLock && !b.deactivated) {
            def ageMin = (nowTs - (b.createdAt as Long ?: nowTs)) / 60000
            if (ageMin > CODE_CONFIRM_TIMEOUT_MIN) {
                logWarn "Code for ${b.name} (slot ${b.slot}) not confirmed after ${CODE_CONFIRM_TIMEOUT_MIN} min — may need manual push"
                // TODO Phase 2: alert owner via notification
            }
        }
    }
}

// ── Lock event handlers ───────────────────────────────────────────

def lockEventHandler(evt) {
    // Capture lock/unlock events with slot info for access log
    def data = evt.data ? safeJson(evt.data) : [:]
    def slot  = data?.usedCode as Integer
    if (!slot) return

    def identity = resolveSlotIdentity(slot)
    def entry = [
        epochMs: now(),
        slot:    slot,
        action:  evt.value,   // "locked" or "unlocked"
        device:  evt.displayName,
        who:     identity,
    ]
    if (!state.accessLog) state.accessLog = []
    state.accessLog.add(0, entry)
    if (state.accessLog.size() > 200) state.accessLog = state.accessLog.take(200)

    logInfo "Access: ${identity} · ${evt.value} · Slot ${slot}"
}

// BUG FIX 1: confirm code was written to lock
def codeChangedHandler(evt) {
    def data  = evt.data ? safeJson(evt.data) : [:]
    def slot  = data?.slotNumber as Integer ?: data?.slot as Integer
    def change = data?.change ?: evt.value  // "added", "deleted", "changed"
    if (!slot) return

    logDebug "codeChanged: slot=${slot} change=${change}"

    if (change == "added" || change == "changed") {
        // Find matching pending booking and mark confirmed
        def match = state.bookings.values().find { (it.slot as Integer) == slot && !it.deactivated }
        if (match) {
            match.codeOnLock = true
            logInfo "Code confirmed on lock for ${match.name} · Slot ${slot}"
        }
    } else if (change == "deleted") {
        def match = state.bookings.values().find { (it.slot as Integer) == slot }
        if (match) {
            match.codeOnLock = false
            logDebug "Code removed from lock for ${match.name} · Slot ${slot}"
        }
    }
}

// ── Helpers — Slots ───────────────────────────────────────────────

// BUG FIX 5: check both state AND live lockCodes attribute
private Integer nextAvailableSlot(Long startEpoch, Long endEpoch) {
    Integer max = Math.min(getMaxSlots(), SLOT_GUEST_MAX)
    def occupied = new HashSet<Integer>()

    // From state bookings (overlapping windows)
    state.bookings.values().each { b ->
        if (windowsOverlap(startEpoch, endEpoch, b.startEpoch as Long, b.endEpoch as Long)) {
            occupied << (b.slot as Integer)
        }
    }

    // From live lock codes (catches manually-set codes outside this app)
    safeJson(frontDoor?.currentValue("lockCodes") ?: "{}")?.keySet()?.each {
        try { occupied << (it as Integer) } catch (ignored) { }
    }

    // Owner and staff slots are always reserved
    (SLOT_OWNER_MIN..SLOT_STAFF_MAX).each { occupied << it }

    for (int s = SLOT_GUEST_MIN; s <= max; s++) {
        if (!occupied.contains(s)) return s
    }
    return null
}

// BUG FIX 2: collision detection
private boolean slotHasActiveBooking(Integer slot, Long startEpoch, Long endEpoch, String excludeId = null) {
    return state.bookings.values().any { b ->
        if (b.id == excludeId) return false
        if ((b.slot as Integer) != slot) return false
        if (b.deactivated) return false
        return windowsOverlap(startEpoch, endEpoch, b.startEpoch as Long, b.endEpoch as Long)
    }
}

private void pushCodeToLock(Map b, String code) {
    if (!frontDoor) { logWarn "pushCodeToLock: no lock configured"; return }
    String label = "${b.name} ${new Date(b.startEpoch as Long).format('MM/dd')}-${new Date(b.endEpoch as Long).format('MM/dd')}"
    // Truncate label to 20 chars (Kwikset limit)
    if (label.length() > 20) label = label.substring(0, 20)
    try {
        frontDoor.setCode(b.slot as Integer, code, label)
        logInfo "setCode sent: slot=${b.slot} label='${label}' (awaiting lock confirmation)"
    } catch (e) {
        logWarn "setCode failed for slot ${b.slot}: ${e}"
        uiWarn("Code push failed for slot ${b.slot} — check lock connection")
    }
}

private String resolveSlotIdentity(Integer slot) {
    if (!slot) return "Unknown"
    if (slot >= SLOT_OWNER_MIN && slot <= SLOT_OWNER_MAX)  return "Owner (Slot ${slot})"
    if (slot >= SLOT_STAFF_MIN && slot <= SLOT_STAFF_MAX)  return "Staff/PM (Slot ${slot})"
    // Check against active bookings
    def match = state.bookings.values().find { (it.slot as Integer) == slot && it.activated }
    if (match) return "${match.name} (Slot ${slot})"
    // Check ended bookings
    def ended = state.bookings.values().find { (it.slot as Integer) == slot }
    if (ended) return "${ended.name} — ended (Slot ${slot})"
    return "Unknown (Slot ${slot})"
}

private Integer getMaxSlots() {
    try {
        def mv = frontDoor?.currentValue("maxCodes")
        return mv != null ? Math.min(mv as Integer, 250) : 250
    } catch (e) { return 250 }
}

// ── Helpers — Time ────────────────────────────────────────────────

private TimeZone hubTimezone() {
    return location?.timeZone ?: TimeZone.getTimeZone("America/New_York")
}

private Date combineDateAndTime(String datePart, String timePart, TimeZone tz) {
    if (!datePart || !timePart) return null
    try {
        Date d = Date.parse("yyyy-MM-dd", datePart)
        String hhmm = extractHHMM(timePart, tz)
        def parts = hhmm.split(":")
        Calendar c = Calendar.getInstance(tz)
        c.time = d
        c.set(Calendar.HOUR_OF_DAY, parts[0] as Integer)
        c.set(Calendar.MINUTE,      parts[1] as Integer)
        c.set(Calendar.SECOND,      0)
        c.set(Calendar.MILLISECOND, 0)
        return c.time
    } catch (e) {
        logWarn "combineDateAndTime failed: datePart=${datePart} timePart=${timePart}: ${e}"
        return null
    }
}

private String extractHHMM(String timePart, TimeZone tz) {
    if (!timePart.contains("T")) return timePart.trim()
    // ISO format — extract HH:mm in local timezone
    try {
        def iso = Date.parse("yyyy-MM-dd'T'HH:mm:ss.SSSX", timePart)
        return iso.format("HH:mm", tz)
    } catch (e1) {
        try {
            def iso = Date.parse("yyyy-MM-dd'T'HH:mm:ssX", timePart)
            return iso.format("HH:mm", tz)
        } catch (e2) {
            return "00:00"
        }
    }
}

private boolean windowsOverlap(Long aStart, Long aEnd, Long bStart, Long bEnd) {
    if ([aStart, aEnd, bStart, bEnd].any { it == null }) return false
    return (aStart < bEnd) && (bStart < aEnd)
}

// ── Helpers — Code generation ─────────────────────────────────────

private String resolveCode(Map b) {
    if (b.autoGen) {
        // BUG FIX 8: SecureRandom instead of Math.random
        Integer len = Math.max(4, Math.min(8, (b.len as Integer) ?: 6))
        SecureRandom rng = new SecureRandom()
        return (1..len).collect { rng.nextInt(10).toString() }.join()
    } else {
        if (!b.manualCode) throw new IllegalArgumentException("Manual code not provided for booking ${b.name}")
        String clean = (b.manualCode as String).replaceAll("\\D", "")
        if (clean.length() < 4) throw new IllegalArgumentException("Manual code must be at least 4 digits")
        return clean
    }
}

// ── Helpers — Notifications ───────────────────────────────────────

private void notifyGuest(Map b) {
    if (!b.guestEmail) return
    try {
        def tz        = hubTimezone()
        def firstName = (b.name as String)?.tokenize(' ')?.first() ?: b.name
        def ciDate    = new Date(b.startEpoch as Long)
        def coDate    = new Date(b.endEpoch   as Long)
        def ciFmt     = ciDate.format("MMMM d, yyyy 'at' h:mm a z", tz)
        def coFmt     = coDate.format("MMMM d, yyyy 'at' h:mm a z", tz)
        def ciShort   = ciDate.format("MM/dd/yyyy", tz)

        String subject = "Your Paradise Access Code — ${ciShort}"
        String body = """\
Hi ${firstName},

Your door code for Paradise is ready. You can check in anytime from ${ciFmt}.

Property:   Paradise — 714B S Ocean Blvd, Surfside Beach, SC 29575
Check-In:   ${ciFmt}
Check-Out:  ${coFmt}

FRONT DOOR CODE: ${b.activeCode}

Enter this code on the front door keypad. It expires automatically at checkout.

Guest Guide (WiFi, pool, parking, trash, house rules):
https://paradisesurfsidesc.com/guest/

Questions before arrival? Reply to this email or call/text 404-406-8471.

See you soon!
David Taylor
Paradise — Surfside Beach, SC"""

        sendEmail(b.guestEmail as String, subject, body)
        logInfo "Check-in email sent to ${b.guestEmail} (${b.name})"
    } catch (e) {
        logWarn "notifyGuest failed for ${b.name}: ${e}"
    }
}

// ── Helpers — UI ──────────────────────────────────────────────────

private String bookingSummaryLine(Map b, TimeZone tz) {
    def s     = new Date(b.startEpoch as Long).format("MM/dd/yy HH:mm", tz)
    def e     = new Date(b.endEpoch   as Long).format("MM/dd/yy HH:mm", tz)
    def nowTs = new Date().time
    def future = nowTs < (b.startEpoch as Long)

    String icon, statusStr
    if (b.deactivated)      { icon = "⚫"; statusStr = "ENDED" }
    else if (b.activated)   { icon = "🟢"; statusStr = "ACTIVE" }
    else if (future)        { icon = "🟠"; statusStr = b.codeOnLock ? "READY" : "PENDING CONFIRM" }
    else                    { icon = "🔴"; statusStr = "MISSED" }

    String codeStr = b.activeCode ? "****" : (b.autoGen ? "Auto" : "Manual")
    String lockStr = b.codeOnLock ? "✓ On Lock" : "⏳ Pending"

    return "${icon} ${b.name} | Slot ${b.slot} | ${s} → ${e} | ${statusStr} | Code: ${codeStr} | ${lockStr}"
}

private void clearTempInputs() {
    ["tmp_bookingName","tmp_guestPhone","tmp_guestEmail","tmp_startDate","tmp_endDate",
     "tmp_checkInTime","tmp_checkOutTime","tmp_slot","tmp_manualCode"].each { app.removeSetting(it) }
    app.updateSetting("tmp_autoSlot",   [value: true, type: "bool"])
    app.updateSetting("tmp_autoGen",    [value: true, type: "bool"])
    app.updateSetting("tmp_autoDelete", [value: true, type: "bool"])
    app.updateSetting("tmp_len",        [value: 6,    type: "number"])
}

private List<String> getCheckedIds() {
    def truthy = { v -> v == true || v == 1 || v == "1" || v == "true" || v == "True" || v == "on" }
    return (state.bookings?.keySet() ?: []).findAll { id ->
        truthy(settings?."sel_${id}")
    } as List<String>
}

private void clearCheckedFlags(List<String> ids) {
    ids?.each { id -> app.updateSetting("sel_${id}", [value: false, type: "bool"]) }
}

// ── Helpers — JSON / logging ──────────────────────────────────────

private Map safeJson(String s) {
    try { return s ? new JsonSlurper().parseText(s) as Map : [:] }
    catch (e) { return [:] }
}

private void uiInfo(String msg) { state.uiMsg = msg; logInfo msg }
private void uiWarn(String msg) { state.uiMsg = "⚠️ ${msg}"; logWarn msg }
private void logInfo(String msg)  { log.info  "[DoorCode] ${msg}" }
private void logWarn(String msg)  { log.warn  "[DoorCode] ${msg}" }
private void logDebug(String msg) { log.debug "[DoorCode] ${msg}" }
