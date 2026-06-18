# SunPeak SP-50 / SP-60 String Inverter — Field Service Manual

## Overview
The SunPeak SP-50 is a 50 kW three-phase string inverter with 4 MPPT inputs
(SP-60: 60 kW, 5 inputs). Assets INV-07 and INV-08 are SP-50 units at
SITE-Bengaluru-3; INV-12 is an SP-60.

## Fault: INV-LOWOUT (low output power)
Symptoms: measured AC output well below expected for the current irradiance;
one or more strings reading low current.

Procedure — IV-curve trace:
1. Isolate the suspect string at the DC isolator before touching connectors.
2. Run an IV-curve trace on each string feeding the inverter.
3. A flat or stepped curve indicates a broken MC4 connector or a shaded/soiled
   module. Replace the MC4 connector (part MC4-connector) if resistance is high.
4. Reconnect, clear the fault, and confirm output recovers within 2 minutes.

Most INV-LOWOUT events on INV-07 historically trace to a degraded MC4 connector
on string 2.

## Fault: INV-OVERTEMP (over-temperature derating)
The inverter derates output above 60 C heatsink temperature.
Procedure — thermal imaging scan:
1. Thermal-scan the heatsink and cooling fans under load.
2. Clean the cooling fan (part cooling-fan) and clear airflow obstructions.
3. Recalibrate the MPPT module if derating persists after cooling.

## Fault: INV-OFFLINE (no communications)
1. Check the AC and DC isolators are closed.
2. Power-cycle the communications card; wait 90 seconds for re-registration.
3. If still offline, replace the comms card and re-add the unit to the gateway.

## Safety
Always isolate DC before working on connectors. PV strings remain live in
daylight even when the inverter is off.
