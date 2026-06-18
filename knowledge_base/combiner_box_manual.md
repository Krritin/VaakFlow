# Combiner Box CB-B — Maintenance Procedures

## Overview
Combiner box CB-B aggregates 8 PV string inputs at SITE-Bengaluru-3, each
protected by a 15 A string fuse and feeding a common DC bus to the inverter.

## Fault: CB-FUSE (blown combiner fuse)
Symptoms: one string contributes no current; inverter shows reduced output.

Procedure — combiner fuse replacement:
1. Open the DC isolator and verify zero volts across the suspect fuse holder.
2. Remove the blown fuse and replace with a string-fuse-15A of identical rating.
3. Never bypass or up-rate a fuse — it protects the string wiring.
4. Close the isolator and confirm the string current returns to nominal.

## Fault: STR-OPEN (open string)
A broken connector or cut cable shows as zero string current with an intact
fuse. Trace the string, repair the connector (MC4-connector), and re-test.

## Inspection checklist
- Check for water ingress and corrosion on terminals.
- Confirm surge arrestor (part surge-arrestor) indicator is green.
- Torque-check all DC terminals to spec.
