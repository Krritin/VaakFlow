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

  ## Fault: CB-ARC (DC arc / hotspot)
  Symptoms: scorch marks, a burning smell, or a thermal hotspot on a terminal block.
  1. Isolate immediately and do NOT re-energise until repaired — DC arcs are
     self-sustaining and a fire risk.
  2. Thermal-scan all terminals under load once it is safe.
  3. Re-torque loose terminals to spec (part terminal-block) and replace any
     charred connectors.
  4. Escalate to a supervisor — arc faults are treated as high severity.

  ## Fault: CB-WATER (water ingress)
  Symptoms: condensation inside the enclosure, corrosion on busbars, ground-fault
  trips after rain.
  1. Isolate and dry the enclosure; inspect the gland seals and door gasket.
  2. Replace failed cable glands (part cable-gland) and the door gasket.
  3. Reseal conduit entries and confirm the enclosure IP rating is intact.

  ## Fault: CB-GNDFLT (ground fault)
  A ground fault on the combiner trips the inverter's GFDI.
  1. Isolate and megger-test each string to ground to find the faulted string.
  2. Inspect that string's cabling for damaged insulation; repair or replace.
  3. Clear the fault at the inverter and confirm there is no re-trip.

  ## Inspection checklist
  - Check for water ingress and corrosion on terminals.
  - Confirm surge arrestor (part surge-arrestor) indicator is green.
  - Torque-check all DC terminals to spec.