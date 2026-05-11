/**
 *  Paradise Pump Speed Scheduler
 *  Version: 1.0.0
 *
 *  Controls ZEN16 pump speed relays based on Santee Cooper time-of-use peak hours
 *  and season (Summer: April-October / Winter: November-March).
 *
 *  Devices:
 *    Relay 1 (device 85) = Speed 2 · 2000 RPM  (baseline / peak fallback)
 *    Relay 2 (device 86) = Speed 3 · 3000 RPM  (off-peak performance)
 *    Heater  (device 11) = Qubino NO relay      (ON = heater allowed to run)
 *
 *  Summer Schedule (April 1 – October 31):
 *    00:00 – 15:00  → Speed 3
 *    15:00 – 18:15  → Speed 2 only  (Santee Cooper peak 3–6 PM)
 *    18:15 – 23:00  → Speed 3
 *    23:00 – 00:00  → Speed 2 (night)
 *
 *  Winter Schedule (November 1 – March 31):
 *    00:00 – 06:00  → Speed 2
 *    06:00 – 09:15  → Pump OFF      (Santee Cooper peak 6–9 AM)
 *    09:15 – 00:00  → Speed 2
 *
 *  Heater:
 *    Peak start → heater off (state saved)
 *    Peak end   → heater restored only if it was on when peak started
 *
 *  Future hooks for ORP, pH, flow meter override are marked with TODO comments.
 */

definition(
    name:        "Paradise Pump Scheduler",
    namespace:   "paradise",
    author:      "Paradise Automation",
    description: "Manages ZEN16 pump speed relays and heater around Santee Cooper peak hours by season.",
    category:    "Convenience",
    iconUrl:     "",
    iconX2Url:   ""
)

preferences {
    page(name: "mainPage")
}

def mainPage() {
    dynamicPage(name: "mainPage", title: "Paradise Pump Scheduler", install: true, uninstall: true) {

        section("Pump Relays") {
            input "relay1", "capability.switch", title: "Relay 1 — Speed 2 (2000 RPM)", required: true
            input "relay2", "capability.switch", title: "Relay 2 — Speed 3 (3000 RPM)", required: true
        }

        section("Heater") {
            input "heater",     "capability.switch",             title: "Heater relay (Qubino — ON = runs)", required: true
            input "poolTempIn", "capability.temperatureMeasurement", title: "Pool Temp - In sensor",         required: false
        }

        section("Season Dates") {
            paragraph "Summer: April 1 – October 31  (Santee Cooper peak 3:00–6:00 PM)\nWinter: November 1 – March 31  (Santee Cooper peak 6:00–9:00 AM)"
        }

        section("Logging") {
            input "enableLogging", "bool", title: "Enable debug logging", defaultValue: true
        }
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

def installed() {
    log.info "Paradise Pump Scheduler installed"
    initialize()
}

def updated() {
    log.info "Paradise Pump Scheduler updated"
    unschedule()
    initialize()
}

def uninstalled() {
    log.info "Paradise Pump Scheduler uninstalled — unscheduling all jobs"
    unschedule()
}

def initialize() {
    logDebug "Initializing schedules"

    // Ensure state variable exists for heater restore logic
    if (state.heaterWasOn == null) state.heaterWasOn = false

    // ── Summer schedules (April–October) ──────────────────────────────────────
    // 00:00 — Speed 3 (from midnight, season check inside handler)
    schedule("0 0 0 * * ?",  "summerMidnight")

    // 15:00 — Peak starts: drop to Speed 2, heater off
    schedule("0 0 15 * * ?", "summerPeakStart")

    // 18:15 — Peak ends: resume Speed 3, restore heater
    schedule("0 15 18 * * ?", "summerPeakEnd")

    // 23:00 — Night: drop to Speed 2
    schedule("0 0 23 * * ?", "summerNight")

    // ── Winter schedules (November–March) ─────────────────────────────────────
    // 06:00 — Peak starts: pump off, heater off
    schedule("0 0 6 * * ?",  "winterPeakStart")

    // 09:15 — Peak ends: resume Speed 2, restore heater
    schedule("0 15 9 * * ?", "winterPeakEnd")

    // ── Season transition handlers ─────────────────────────────────────────────
    // April 1 at 00:01 — switch to summer mode
    schedule("0 1 0 1 4 ?", "transitionToSummer")

    // November 1 at 00:01 — switch to winter mode
    schedule("0 1 0 1 11 ?", "transitionToWinter")

    // Apply correct state right now based on current time and season
    applyCurrentSchedule()
}

// ─── Season helpers ───────────────────────────────────────────────────────────

def isSummer() {
    def month = new Date().month + 1  // Java month is 0-indexed
    return (month >= 4 && month <= 10)
}

def isWinter() {
    return !isSummer()
}

// ─── Scheduled handlers ───────────────────────────────────────────────────────

def summerMidnight() {
    if (!isSummer()) { logDebug "summerMidnight fired but it is winter — skipping"; return }
    logDebug "Summer midnight — activating Speed 3"
    speed3On()
}

def summerPeakStart() {
    if (!isSummer()) { logDebug "summerPeakStart fired but it is winter — skipping"; return }
    logInfo "Summer peak start (3:00 PM) — dropping to Speed 2, pausing heater"
    saveHeaterState()
    speed2On()
    heaterOff()
}

def summerPeakEnd() {
    if (!isSummer()) { logDebug "summerPeakEnd fired but it is winter — skipping"; return }
    logInfo "Summer peak end (6:15 PM) — resuming Speed 3, restoring heater"
    speed3On()
    restoreHeater()
}

def summerNight() {
    if (!isSummer()) { logDebug "summerNight fired but it is winter — skipping"; return }
    logInfo "Summer night (11:00 PM) — dropping to Speed 2"
    speed2On()
    // Heater is not touched at night — it runs or not based on its own state
}

def winterPeakStart() {
    if (!isWinter()) { logDebug "winterPeakStart fired but it is summer — skipping"; return }
    logInfo "Winter peak start (6:00 AM) — pump off, pausing heater"
    saveHeaterState()
    pumpOff()
    heaterOff()
}

def winterPeakEnd() {
    if (!isWinter()) { logDebug "winterPeakEnd fired but it is summer — skipping"; return }
    logInfo "Winter peak end (9:15 AM) — resuming Speed 2, restoring heater"
    speed2On()
    restoreHeater()
}

def transitionToSummer() {
    logInfo "Season transition → Summer (April 1)"
    applyCurrentSchedule()
}

def transitionToWinter() {
    logInfo "Season transition → Winter (November 1)"
    applyCurrentSchedule()
}

// ─── Core schedule applier ────────────────────────────────────────────────────
// Called on initialize and season transitions to set correct state immediately
// rather than waiting for the next scheduled trigger to fire.

def applyCurrentSchedule() {
    def now   = new Date()
    def hour  = now.hours
    def min   = now.minutes
    def hhmm  = hour * 60 + min  // minutes since midnight for easy comparison

    logInfo "Applying current schedule — season: ${isSummer() ? 'Summer' : 'Winter'}, time: ${String.format('%02d:%02d', hour, min)}"

    if (isSummer()) {
        // 00:00–15:00 → Speed 3
        if (hhmm < (15 * 60)) {
            logDebug "applyCurrentSchedule: Summer pre-peak → Speed 3"
            speed3On()
        }
        // 15:00–18:15 → Speed 2 (peak)
        else if (hhmm >= (15 * 60) && hhmm < (18 * 60 + 15)) {
            logDebug "applyCurrentSchedule: Summer peak → Speed 2"
            speed2On()
        }
        // 18:15–23:00 → Speed 3
        else if (hhmm >= (18 * 60 + 15) && hhmm < (23 * 60)) {
            logDebug "applyCurrentSchedule: Summer post-peak → Speed 3"
            speed3On()
        }
        // 23:00–00:00 → Speed 2 (night)
        else {
            logDebug "applyCurrentSchedule: Summer night → Speed 2"
            speed2On()
        }
    } else {
        // Winter
        // 06:00–09:15 → pump off (peak)
        if (hhmm >= (6 * 60) && hhmm < (9 * 60 + 15)) {
            logDebug "applyCurrentSchedule: Winter peak → pump off"
            pumpOff()
        }
        // All other winter hours → Speed 2
        else {
            logDebug "applyCurrentSchedule: Winter off-peak → Speed 2"
            speed2On()
        }
    }

    // TODO: Add ORP/pH/flow meter override check here in Phase 2
    // e.g. if ORP < 650 or pH out of range, keep pump running through peak regardless
}

// ─── Relay control helpers ────────────────────────────────────────────────────

def speed2On() {
    // Relay 1 ON, Relay 2 OFF — interlocked to prevent both running simultaneously
    logDebug "→ Speed 2 ON (Relay 1 on, Relay 2 off)"
    relay1.on()
    relay2.off()
}

def speed3On() {
    // Relay 2 ON, Relay 1 OFF — interlocked
    logDebug "→ Speed 3 ON (Relay 2 on, Relay 1 off)"
    relay2.on()
    relay1.off()
}

def pumpOff() {
    // Both relays off — used during winter peak
    logDebug "→ Pump OFF (both relays off)"
    relay1.off()
    relay2.off()
}

// ─── Heater helpers ───────────────────────────────────────────────────────────

def saveHeaterState() {
    def currentState = heater.currentSwitch
    state.heaterWasOn = (currentState == "on")
    logDebug "Heater state saved: heaterWasOn = ${state.heaterWasOn}"
}

def heaterOff() {
    logDebug "→ Heater OFF (peak hour)"
    heater.off()
}

def restoreHeater() {
    if (state.heaterWasOn) {
        logInfo "→ Heater restored ON (was on when peak started)"
        heater.on()
        state.heaterWasOn = false
    } else {
        logDebug "Heater not restored — was not on when peak started"
    }

    // TODO Phase 2: before restoring heater, check poolTempIn against setpoint
    // e.g. if (poolTempIn && poolTempIn.currentTemperature >= targetTemp) { skip restore }
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

def logDebug(msg) {
    if (enableLogging) log.debug "[PumpScheduler] ${msg}"
}

def logInfo(msg) {
    log.info "[PumpScheduler] ${msg}"
}

// ─── Thermostat — 76°F at 11am June–August ────────────────────────────────────
// Added to existing app preferences — add these inputs to mainPage():
//   input "ecobeeUpstairs", "capability.thermostat", title: "Ecobee Upstairs (device 2)", required: false
//   input "ecobeeMain",     "capability.thermostat", title: "Ecobee Main Floor (device 3)", required: false

def thermostatSetpoint() {
    def month = new Date().month + 1
    if (month < 6 || month > 8) {
        logDebug "thermostatSetpoint: not rental season (month ${month}) — skipping"
        return
    }
    logInfo "11 AM rental season — setting both thermostats to 76°F cooling setpoint"
    [ecobeeUpstairs, ecobeeMain].each { t ->
        if (t) {
            try {
                t.setCoolingSetpoint(76)
                logInfo "Set cooling setpoint 76°F on ${t.displayName}"
            } catch (e) {
                logWarn "Failed to set thermostat ${t?.displayName}: ${e}"
            }
        }
    }
}
