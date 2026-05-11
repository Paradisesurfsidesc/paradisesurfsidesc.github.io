/**
 * Paradise Pool Service Tracker
 * Version: 1.0.0 — 2026-05-10
 *
 * Tracks Southstrand PM pool service visits using:
 *   - Pump Room door contact sensor (device 42) — primary detection
 *   - Pump Room Multi Sensor (device 43)         — motion confirmation
 *   - 6:00 AM snapshot on service days           — before chemistry
 *   - 6:00 PM snapshot on service days           — after chemistry
 *
 * Service schedule:
 *   Winter  (Nov–Mar): 1x/week — Thursday
 *   Shoulder(Apr–May, Sep–Oct): 1x/week — Thursday
 *   Summer  (Jun–Aug): 3x/week — Monday, Wednesday, Friday
 *
 * SC DHEC water quality targets:
 *   Free chlorine: 1–8 ppm
 *   pH:            7.0–7.8
 */

import groovy.json.JsonOutput

definition(
    name:        "Paradise Pool Service Tracker",
    namespace:   "paradise",
    author:      "David Taylor",
    description: "Tracks Southstrand PM pool service visits, chemistry snapshots, and no-show alerts.",
    category:    "Convenience",
    iconUrl:     "",
    iconX2Url:   "",
    singleInstance: true
)

@Field static final float CL_MIN  = 1.0
@Field static final float CL_MAX  = 8.0
@Field static final float PH_MIN  = 7.0
@Field static final float PH_MAX  = 7.8
@Field static final int   VISIT_LOG_MAX = 100

preferences {
    page(name: "mainPage")
    page(name: "logVisitPage")
    page(name: "visitHistoryPage")
    page(name: "schedulePage")
}

def installed() {
    log.info "Paradise Pool Service Tracker installed"
    initState()
    initialize()
}

def updated() {
    log.info "Paradise Pool Service Tracker updated"
    unsubscribe()
    unschedule()
    initialize()
}

def uninstalled() {
    unsubscribe()
    unschedule()
}

private void initState() {
    if (!state.visits)             state.visits             = []
    if (!state.activeVisit)        state.activeVisit        = null
    if (!state.chemSnapshots)      state.chemSnapshots      = []
    if (!state.missedVisits)       state.missedVisits       = []
}

private void initialize() {
    initState()
    if (pumpRoomDoor)   subscribe(pumpRoomDoor,   "contact", doorHandler)
    if (pumpRoomMotion) subscribe(pumpRoomMotion, "motion",  motionHandler)
    schedule("0 0 6  * * ?", "morningSnapshot")
    schedule("0 0 18 * * ?", "eveningSnapshot")
    schedule("0 0 20 * * ?", "noShowCheck")
    logInfo "Pool Service Tracker initialized"
}

def mainPage() {
    dynamicPage(name: "mainPage", title: "Paradise Pool Service Tracker", install: true, uninstall: true) {
        section("Sensors") {
            input "pumpRoomDoor",   "capability.contactSensor", title: "Pump Room Door (contact sensor)", required: true
            input "pumpRoomMotion", "capability.motionSensor",  title: "Pump Room Motion sensor",         required: false
            input "orpSensor",      "capability.sensor",        title: "ORP Sensor (when available)",     required: false
            input "phSensor",       "capability.sensor",        title: "pH Sensor (when available)",      required: false
        }
        section("Notifications") {
            input "notifyPhone",  "string", title: "Owner phone for no-show alerts", required: false
            input "noShowAlerts", "bool",   title: "Enable no-show alerts",          defaultValue: true
        }
        section("Status") {
            paragraph state.uiMsg ?: "Ready."
            if (state.activeVisit) {
                def v = state.activeVisit
                def tz = hubTimezone()
                def start = new Date(v.arrivalEpoch as Long).format("HH:mm", tz)
                paragraph "VISIT IN PROGRESS\nArrived: ${start}\nDoor opened ${v.doorOpenCount ?: 1} time(s)"
            } else {
                paragraph "Next service: ${nextServiceDay()}"
            }
        }
        section("Actions") {
            href name: "toLog",     page: "logVisitPage",     title: "Log Chemistry",    description: "Manually log chlorine and pH readings"
            href name: "toHistory", page: "visitHistoryPage", title: "Visit History",    description: "View past service visits"
            href name: "toSched",   page: "schedulePage",     title: "Service Schedule", description: "Configure service days by season"
            input "refreshBtn",  "button", title: "Refresh",         submitOnChange: true
            input "simulateBtn", "button", title: "Simulate Visit",  submitOnChange: true
        }
    }
}

def logVisitPage() {
    dynamicPage(name: "logVisitPage", title: "Log Chemistry Reading") {
        section("Reading Type") {
            input "chem_type", "enum", title: "Reading type",
                  options: ["Before service","After service","Routine check","Problem found"],
                  required: true, defaultValue: "After service"
            input "chem_date", "date", title: "Date", required: true
            input "chem_time", "time", title: "Time", required: true, defaultValue: "18:00"
        }
        section("SC DHEC Parameters") {
            input "chem_cl_free", "decimal", title: "Free chlorine (ppm) Target: 1-8",  required: false
            input "chem_cl_comb", "decimal", title: "Combined chlorine (ppm)",           required: false
            input "chem_ph",      "decimal", title: "pH Target: 7.0-7.8",               required: false
            input "chem_alk",     "decimal", title: "Total alkalinity (ppm) Target: 80-120", required: false
            input "chem_cya",     "decimal", title: "Cyanuric acid (ppm) Target: 30-50",    required: false
            input "chem_cal",     "decimal", title: "Calcium hardness (ppm) Target: 200-400", required: false
        }
        section("Notes") {
            input "chem_notes", "string", title: "Notes (treatments added, observations)", required: false
            input "chem_tech",  "string", title: "Technician name", required: false
        }
        section {
            input "saveChemBtn", "button", title: "Save Reading", submitOnChange: true
            href name: "exitChem", page: "mainPage", title: "Cancel"
        }
    }
}

def visitHistoryPage() {
    def tz = hubTimezone()
    dynamicPage(name: "visitHistoryPage", title: "Visit History") {
        section {
            if (!state.visits || state.visits.isEmpty()) {
                paragraph "No visits recorded yet."
            } else {
                state.visits.sort { -(it.dateEpoch as Long) }.take(20).each { v ->
                    def date     = new Date(v.dateEpoch as Long).format("MM/dd/yyyy", tz)
                    def arrived  = v.arrivalEpoch   ? new Date(v.arrivalEpoch  as Long).format("HH:mm", tz) : "Not detected"
                    def departed = v.departureEpoch ? new Date(v.departureEpoch as Long).format("HH:mm", tz) : "Not detected"
                    def duration = (v.arrivalEpoch && v.departureEpoch)
                        ? "${Math.round(((v.departureEpoch as Long) - (v.arrivalEpoch as Long)) / 60000)} min" : "—"
                    def status  = v.missed ? "MISSED" : (v.detected ? "COMPLETED" : "EXPECTED")
                    def clB = v.chemBefore?.clFree ? "${v.chemBefore.clFree} ppm" : "—"
                    def clA = v.chemAfter?.clFree  ? "${v.chemAfter.clFree} ppm"  : "—"
                    def phB = v.chemBefore?.ph ? "${v.chemBefore.ph}" : "—"
                    def phA = v.chemAfter?.ph  ? "${v.chemAfter.ph}"  : "—"
                    paragraph "${status} - ${date}\nArrived: ${arrived} Departed: ${departed} Duration: ${duration}\nCl before/after: ${clB} / ${clA}\npH before/after: ${phB} / ${phA}${v.notes ? '\n' + v.notes : ''}"
                }
            }
        }
        section("Missed Visits") {
            if (!state.missedVisits || state.missedVisits.isEmpty()) {
                paragraph "No missed visits recorded."
            } else {
                state.missedVisits.take(10).each { m ->
                    paragraph "MISSED: ${new Date(m.dateEpoch as Long).format('MM/dd/yyyy', tz)}"
                }
            }
        }
        section {
            input "clearVisitsBtn", "button", title: "Clear History", submitOnChange: true
        }
    }
}

def schedulePage() {
    dynamicPage(name: "schedulePage", title: "Service Schedule") {
        section("Winter (November - March) - 1x/week") {
            input "winterDays", "enum", title: "Service day(s)",
                  options: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
                  multiple: true, required: true, defaultValue: ["Thursday"]
        }
        section("Shoulder (April-May, September-October) - 1x/week") {
            input "shoulderDays", "enum", title: "Service day(s)",
                  options: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
                  multiple: true, required: true, defaultValue: ["Thursday"]
        }
        section("Summer (June - August) - 3x/week") {
            input "summerDays", "enum", title: "Service day(s)",
                  options: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
                  multiple: true, required: true, defaultValue: ["Monday","Wednesday","Friday"]
        }
        section {
            paragraph "Detection: any pump room door/motion event during the service day\nSnapshots: 6:00 AM (before service) and 6:00 PM (after service)"
        }
    }
}

def appButtonHandler(btn) {
    switch(btn) {
        case "refreshBtn":    uiInfo("Refreshed at ${new Date().format('HH:mm:ss')}"); break
        case "simulateBtn":   simulateVisit(); break
        case "saveChemBtn":   saveChemReading(); break
        case "clearVisitsBtn": state.visits = []; state.missedVisits = []; uiInfo("Visit history cleared."); break
    }
}

def doorHandler(evt) {
    logDebug "Pump room door: ${evt.value}"
    if (!isServiceDay()) { logUnscheduledAccess("door_${evt.value}"); return }
    if (evt.value == "open") {
        if (!state.activeVisit) {
            state.activeVisit = [
                dateEpoch:     todayMidnight(),
                arrivalEpoch:  now(),
                doorOpenCount: 1,
                motionEvents:  0,
                detected:      true,
                missed:        false,
                notes:         "",
            ]
            logInfo "Southstrand PM visit started at ${new Date().format('HH:mm:ss')}"
            uiInfo("Pool service visit started")
        } else {
            state.activeVisit.doorOpenCount = (state.activeVisit.doorOpenCount ?: 0) + 1
        }
    }
}

def motionHandler(evt) {
    if (evt.value == "active" && state.activeVisit) {
        state.activeVisit.motionEvents = (state.activeVisit.motionEvents ?: 0) + 1
    }
}

def morningSnapshot() {
    if (!isServiceDay()) return
    logInfo "6 AM chemistry snapshot"
    state.todayBeforeSnapshot = takeChemSnapshot("before")
    uiInfo("Morning chemistry snapshot taken")
}

def eveningSnapshot() {
    if (!isServiceDay()) return
    logInfo "6 PM chemistry snapshot"
    def afterSnap = takeChemSnapshot("after")
    if (state.activeVisit) {
        def v = state.activeVisit
        if (!v.departureEpoch) v.departureEpoch = now()
        v.chemBefore = state.todayBeforeSnapshot ?: [:]
        v.chemAfter  = afterSnap
        v.notes      = buildVisitNotes(v.chemBefore, afterSnap)
        saveVisit(v)
        state.activeVisit         = null
        state.todayBeforeSnapshot = null
        uiInfo("Visit completed and logged")
    }
}

def noShowCheck() {
    if (!isServiceDay()) return
    if (state.activeVisit) { eveningSnapshot(); return }
    def events = getDeviceEventsToday(pumpRoomDoor)
    if (!events) {
        logWarn "NO SHOW: No pump room access on service day"
        recordMissedVisit()
        if (noShowAlerts && notifyPhone) {
            sendSmsNotification(notifyPhone, "Paradise Pool: Southstrand PM did not service the pool today (${new Date().format('MM/dd/yyyy')}). No pump room access detected.")
        }
        uiInfo("No-show recorded")
    }
}

private Map takeChemSnapshot(String type) {
    def snap = [
        type:         type,
        epochMs:      now(),
        clFree:       orpSensor ? getAttr(orpSensor, "orp") : null,
        ph:           phSensor  ? getAttr(phSensor,  "pH")  : null,
        sensorOnline: (orpSensor != null && phSensor != null),
    ]
    if (snap.clFree != null) snap.clStatus = (snap.clFree >= CL_MIN && snap.clFree <= CL_MAX) ? "ok" : "OUT OF RANGE"
    if (snap.ph     != null) snap.phStatus = (snap.ph     >= PH_MIN && snap.ph     <= PH_MAX) ? "ok" : "OUT OF RANGE"
    logInfo "Snapshot (${type}): Cl=${snap.clFree ?: 'offline'} pH=${snap.ph ?: 'offline'}"
    return snap
}

private void saveChemReading() {
    def tz = hubTimezone()
    if (!settings.chem_date || !settings.chem_time) { uiWarn("Date and time required."); return }
    Date readingDT = combineDateAndTime(settings.chem_date, settings.chem_time, tz)
    if (!readingDT) { uiWarn("Invalid date/time."); return }
    def reading = [
        epochMs: readingDT.time,
        type:    settings.chem_type ?: "Routine check",
        clFree:  settings.chem_cl_free ? (settings.chem_cl_free as float) : null,
        clComb:  settings.chem_cl_comb ? (settings.chem_cl_comb as float) : null,
        ph:      settings.chem_ph      ? (settings.chem_ph      as float) : null,
        alk:     settings.chem_alk     ? (settings.chem_alk     as float) : null,
        cya:     settings.chem_cya     ? (settings.chem_cya     as float) : null,
        cal:     settings.chem_cal     ? (settings.chem_cal     as float) : null,
        notes:   settings.chem_notes  ?: "",
        tech:    settings.chem_tech   ?: "Southstrand PM",
        manual:  true,
    ]
    def flags = []
    if (reading.clFree != null && (reading.clFree < CL_MIN || reading.clFree > CL_MAX))
        flags << "Chlorine ${reading.clFree} ppm outside SC DHEC range (${CL_MIN}-${CL_MAX})"
    if (reading.ph != null && (reading.ph < PH_MIN || reading.ph > PH_MAX))
        flags << "pH ${reading.ph} outside SC DHEC range (${PH_MIN}-${PH_MAX})"
    if (!state.chemSnapshots) state.chemSnapshots = []
    state.chemSnapshots.add(0, reading)
    if (state.chemSnapshots.size() > 200) state.chemSnapshots = state.chemSnapshots.take(200)
    String msg = "Chemistry logged: ${settings.chem_type}"
    if (flags) { msg += " - ALERTS: " + flags.join(", "); if (notifyPhone) sendSmsNotification(notifyPhone, "Paradise Pool chemistry alert: ${flags.join(', ')}") }
    uiInfo(msg)
}

private String buildVisitNotes(Map before, Map after) {
    def notes = []
    if (before?.clFree != null && after?.clFree != null) {
        def d = (after.clFree as float) - (before.clFree as float)
        notes << "Cl: ${before.clFree} to ${after.clFree} ppm (${d > 0 ? '+' : ''}${d.round(1)})"
    }
    if (before?.ph != null && after?.ph != null) {
        def d = (after.ph as float) - (before.ph as float)
        notes << "pH: ${before.ph} to ${after.ph} (${d > 0 ? '+' : ''}${d.round(2)})"
    }
    return notes.join(" | ")
}

private void saveVisit(Map v) {
    if (!state.visits) state.visits = []
    state.visits.removeAll { isSameDay(it.dateEpoch as Long, v.dateEpoch as Long) }
    state.visits.add(0, v)
    if (state.visits.size() > VISIT_LOG_MAX) state.visits = state.visits.take(VISIT_LOG_MAX)
}

private void recordMissedVisit() {
    def entry = [dateEpoch: todayMidnight(), missed: true, detected: false]
    if (!state.missedVisits) state.missedVisits = []
    state.missedVisits.add(0, entry)
    saveVisit(entry)
}

private void logUnscheduledAccess(String trigger) {
    logInfo "Unscheduled pump room access: ${trigger} at ${new Date().format('HH:mm:ss MM/dd/yyyy')}"
}

private void simulateVisit() {
    state.activeVisit = [
        dateEpoch:      todayMidnight(),
        arrivalEpoch:   now() - 3600000,
        departureEpoch: now(),
        doorOpenCount:  3,
        motionEvents:   5,
        detected:       true,
        missed:         false,
        chemBefore:     [clFree: 2.1, ph: 7.3, type: "before", sensorOnline: false],
        chemAfter:      [clFree: 3.8, ph: 7.5, type: "after",  sensorOnline: false],
        notes:          "Cl: 2.1 to 3.8 ppm (+1.7) | pH: 7.3 to 7.5 (+0.2)",
    ]
    eveningSnapshot()
    uiInfo("Simulated visit logged")
}

private boolean isServiceDay() {
    return getServiceDays().contains(new Date().format("EEEE"))
}

private List<String> getServiceDays() {
    def month = new Date().month + 1
    if (month >= 6 && month <= 8)  return (settings.summerDays   ?: ["Monday","Wednesday","Friday"]) as List<String>
    if (month >= 11 || month <= 3) return (settings.winterDays   ?: ["Thursday"]) as List<String>
    return (settings.shoulderDays ?: ["Thursday"]) as List<String>
}

private String nextServiceDay() {
    def days    = getServiceDays()
    def dayNums = ["Sunday":0,"Monday":1,"Tuesday":2,"Wednesday":3,"Thursday":4,"Friday":5,"Saturday":6]
    def today   = new Date().day
    def targets = days.collect { dayNums[it] ?: 0 }.sort()
    def next    = targets.find { it > today } ?: targets[0]
    def away    = next > today ? next - today : 7 - today + next
    if (away == 0) return "Today"
    if (away == 1) return "Tomorrow"
    return "In ${away} days (${days.find { (dayNums[it] ?: 0) == next }})"
}

private List getDeviceEventsToday(device) {
    if (!device) return []
    try { return device.events(max: 50).findAll { it.date.time >= todayMidnight() } }
    catch (e) { return [] }
}

private boolean isSameDay(Long a, Long b) {
    return new Date(a).format("yyyy-MM-dd") == new Date(b).format("yyyy-MM-dd")
}

private Long todayMidnight() {
    def c = Calendar.getInstance(hubTimezone())
    c.set(Calendar.HOUR_OF_DAY, 0); c.set(Calendar.MINUTE, 0)
    c.set(Calendar.SECOND, 0);      c.set(Calendar.MILLISECOND, 0)
    return c.timeInMillis
}

private TimeZone hubTimezone() {
    return location?.timeZone ?: TimeZone.getTimeZone("America/New_York")
}

private def getAttr(device, String name) {
    try { return device?.currentValue(name) } catch(e) { return null }
}

private Date combineDateAndTime(String datePart, String timePart, TimeZone tz) {
    if (!datePart || !timePart) return null
    try {
        Date d = Date.parse("yyyy-MM-dd", datePart)
        String hhmm = timePart.contains("T") ? Date.parse("yyyy-MM-dd'T'HH:mm:ssX", timePart).format("HH:mm", tz) : timePart.trim()
        def parts = hhmm.split(":")
        Calendar c = Calendar.getInstance(tz); c.time = d
        c.set(Calendar.HOUR_OF_DAY, parts[0] as Integer); c.set(Calendar.MINUTE, parts[1] as Integer)
        c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
        return c.time
    } catch (e) { return null }
}

private void uiInfo(String msg) { state.uiMsg = msg; logInfo msg }
private void uiWarn(String msg) { state.uiMsg = "WARNING: ${msg}"; logWarn msg }
private void logInfo(String msg)  { log.info  "[PoolService] ${msg}" }
private void logWarn(String msg)  { log.warn  "[PoolService] ${msg}" }
private void logDebug(String msg) { log.debug "[PoolService] ${msg}" }
