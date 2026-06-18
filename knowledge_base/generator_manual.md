# Backup Diesel Generator — Field Service Manual

## Overview
The site backup generator supplies auxiliary and critical loads (SCADA, comms,
security) during grid outages when solar and storage are insufficient. Assets
GEN-01 and GEN-02 are 100 kVA diesel gensets with auto-start controllers at
SITE-Bengaluru-3.

## Fault: GEN-NOSTART (fails to crank or start)
Symptoms: the controller shows a start failure after the configured crank attempts.
Procedure:
1. Check the starter battery voltage (should be >12.4 V at rest). Charge or
   replace a weak battery (part start-battery).
2. Confirm the fuel shutoff solenoid is energising and the fuel level is above the
   low-level cutoff.
3. Bleed air from the fuel line if the genset previously ran out of fuel.
4. Inspect the starter motor and crank relay; replace if it clicks but won't turn.

## Fault: GEN-OVERHEAT (high coolant temperature)
The controller shuts down above the high-temp threshold to protect the engine.
1. Check the coolant level and top up; inspect for leaks at the hoses and radiator.
2. Clean the radiator core and confirm the cooling-fan belt is intact and tensioned.
3. Verify the thermostat opens; replace it if stuck closed.

## Fault: GEN-AVR (unstable output voltage)
Symptoms: output voltage hunts or sits outside the 415 V +/-5% band.
1. Inspect the AVR (automatic voltage regulator) wiring and sensing leads.
2. Confirm engine speed is 1500 rpm / 50 Hz before blaming the AVR.
3. Replace the AVR module (part avr-module) if voltage stays unstable at correct RPM.

## Fault: GEN-FUEL (low fuel / contamination)
1. Refuel above the low-level sensor and log the runtime hours.
2. Drain water from the fuel-water separator; replace the fuel filter
   (part fuel-filter) if flow is restricted.

## Safety
Never refuel a running or hot generator. Keep the exhaust clear and the area
ventilated — exhaust contains carbon monoxide. Lock out the auto-start before
servicing.
