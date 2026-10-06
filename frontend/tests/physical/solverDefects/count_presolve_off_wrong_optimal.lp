Maximize
  obj: total_obj
Subject To
  cover_3: 1 lot_3_0 - 1 n_3 >= -1
  base_sum: 1 base_0 + 1 base_1 = 1
  in_1: 1 n_1 - 1 e_0_1 - 1 e_2_1 = 0
  in_2: 1 n_2 - 1 e_0_2 - 1 e_3_2 = 0
  in_3: 1 n_3 - 1 e_1_3 - 1 e_3_3 - 1 e_4_3 = 0
  slot_0: 1 e_0_1 + 1 e_0_2 <= 1
  slot_3: 1 e_3_2 + 1 e_3_3 - 1 n_1 <= 0
  slot_4: 1 e_4_3 - 1 n_1 <= 0
  node_lo: 1 weight >= 1.5
  node_hi: 1 weight <= 3
  raw_ergo_def: 1 raw_ergo - 22 n_1 - 9 n_2 - 5 n_3 = 25
  rec_mod_def: 1 rec_mod + 0.05 n_3 = 0
  rec_axis_def: 1 rec_axis - 1000 rec_mod = 0
  weight_def: 1 weight - 0.125 n_1 - 0.5 n_2 - 1 n_3 = 1.5
  c1_regime: 1 c1_low + 1 c1_mid + 1 c1_high = 1
  c1_lo: 1 raw_ergo + 203 c1_low <= 203
  c1_hi: 1 raw_ergo - 203 c1_high >= -103
  c1_midlo: 1 raw_ergo - 203 c1_mid >= -203
  c1_midhi: 1 raw_ergo + 203 c1_mid <= 303
  c1_zero: 1 capped_ergo + 100 c1_low <= 100
  c1_full: 1 capped_ergo - 100 c1_high >= 0
  c1_eqlo: 1 capped_ergo - 1 raw_ergo - 203 c1_mid >= -203
  c1_eqhi: 1 capped_ergo - 1 raw_ergo + 203 c1_mid <= 203
  gear_def_lo: 1 gear_ergo - 1.2 capped_ergo >= 0
  gear_def_hi: 1 gear_ergo - 1.2000000000000002 capped_ergo <= 0
  c2_regime: 1 c2_low + 1 c2_mid + 1 c2_high = 1
  c2_lo: 1 gear_ergo + 221 c2_low <= 221
  c2_hi: 1 gear_ergo - 221 c2_high >= -121
  c2_midlo: 1 gear_ergo - 221 c2_mid >= -221
  c2_midhi: 1 gear_ergo + 221 c2_mid <= 321
  c2_zero: 1 eff_ergo + 100 c2_low <= 100
  c2_full: 1 eff_ergo - 100 c2_high >= 0
  c2_eqlo: 1 eff_ergo - 1 gear_ergo - 221 c2_mid >= -221
  c2_eqhi: 1 eff_ergo - 1 gear_ergo + 221 c2_mid <= 221
  ted_def: 1 ted - 1 eff_ergo = 0
  ergo_frame: 1 ergo_axis - 10 ted = 0
  price_def: 1 price_axis - 5000 base_0 - 1100 base_1 - 100 n_1 - 700 lot_3_0 = 0
  lim_recoil_sum: 150 rec_mod <= 5
  lim_weight: 1 weight <= 3.2
  obj_def: 1 total_obj - 0.1 ergo_axis = 0
Bounds
  0 <= n_1 <= 2
  0 <= n_2 <= 2
  0 <= n_3 <= 5
  0 <= e_3_2 <= 2
  0 <= e_3_3 <= 2
  0 <= e_4_3 <= 2
  0 <= lot_3_0 <= 4
  24.999999999999822 <= raw_ergo <= 102.00000000000018
  24.999999999999822 <= capped_ergo <= 100
  -0.25000000000000044 <= rec_mod <= 3.608224830031761e-16
  -250.00000000000048 <= rec_axis <= 3.608224830031762e-13
  0 <= price_axis <= 8000.0000000000055
  1.4999999999999878 <= weight <= 6.750000000000012
  29.999999999999783 <= gear_ergo <= 120.00000000000003
  29.999999999999783 <= eff_ergo <= 100
  29.999999999999783 <= ted <= 100
  299.9999999999978 <= ergo_axis <= 1000.0000000000001
  29.99999999999977 <= total_obj <= 100.00000000000006
General
  n_1 n_2 n_3 e_3_2 e_3_3 e_4_3 lot_3_0
Binary
  base_0 base_1 e_0_1 e_0_2 e_1_3 e_2_1 c1_low c1_mid c1_high c2_low c2_mid c2_high
End