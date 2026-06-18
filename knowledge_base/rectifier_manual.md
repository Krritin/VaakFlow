# Rectifier Unit — Field Service Manual

  ## Overview
  The rectifier converts AC to regulated DC for the site's DC bus and battery
  charging in the AC-coupled storage system. Assets REC-01 and REC-02 are 30 kW
  modular rectifiers at SITE-Bengaluru-3.

  ## Fault: REC-NOOUTPUT (no DC output)
  Symptoms: DC bus voltage low or zero; the charger is not supplying current.
  Procedure:
  1. Confirm AC input is present and within range at the rectifier input terminals.
  2. Check the input fuses/breaker; reset or replace (part fuse-30A).
  3. Inspect the rectifier module status LEDs; reseat or swap the failed module.

  ## Fault: REC-DIODE (failed rectifier diode)
  Symptoms: high ripple, reduced output current, one phase running hot.
  1. Power down and isolate the AC input.
  2. Test each diode in the bridge for short/open; a shorted diode usually trips the
     input breaker.
  3. Replace the failed diode/module (part rectifier-module) and re-torque the busbar
     connections.

  ## Fault: REC-OVERTEMP (thermal derate / shutdown)
  The unit derates and then shuts down above its thermal limit.
  1. Clean the intake filters and clear airflow obstructions.
  2. Verify the cooling fans spin at full speed under load; replace a failed fan
     (part cooling-fan).
  3. Re-check ambient temperature and balance module loading.

  ## Fault: REC-RIPPLE (excessive output ripple)
  Symptoms: noisy DC, batteries gassing or charging poorly.
  1. Inspect the output filter capacitors for bulging or raised ESR; replace the
     capacitor bank (part filter-cap).
  2. Confirm all parallel modules share the load evenly.

  ## Safety
  The DC bus and capacitor bank hold a charge after power-down. Wait for the
  bleed-down time and verify zero volts before touching the output terminals.