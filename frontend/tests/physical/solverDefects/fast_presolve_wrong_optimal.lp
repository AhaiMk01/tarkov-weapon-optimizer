Maximize
  obj: total_obj
Subject To
  base_sum: 1 base_0 = 1
  in_1: 1 n_1 - 1 e_0_1 = 0
  in_2: 1 n_2 - 1 e_1_2 - 1 e_3_2 = 0
  in_3: 1 n_3 - 1 e_1_3 - 1 e_2_3 - 1 e_6_3 = 0
  in_4: 1 n_4 - 1 e_1_4 - 1 e_4_4 - 1 e_5_4 - 1 e_7_4 - 1 e_8_4 = 0
  in_5: 1 n_5 - 1 e_1_5 - 1 e_3_5 - 1 e_4_5 - 1 e_6_5 = 0
  in_6: 1 n_6 - 1 e_2_6 - 1 e_4_6 - 1 e_5_6 - 1 e_9_6 = 0
  slot_1: 1 e_1_2 + 1 e_1_3 + 1 e_1_4 + 1 e_1_5 <= 1
  req_2: 1 e_2_3 + 1 e_2_6 - 1 n_1 = 0
  slot_3: 1 e_3_2 + 1 e_3_5 - 1 n_1 <= 0
  slot_4: 1 e_4_4 + 1 e_4_5 + 1 e_4_6 - 1 n_2 <= 0
  slot_5: 1 e_5_4 + 1 e_5_6 - 1 n_2 <= 0
  slot_6: 1 e_6_3 + 1 e_6_5 - 1 n_2 <= 0
  slot_7: 1 e_7_4 - 1 n_3 <= 0
  slot_8: 1 e_8_4 - 1 n_3 <= 0
  slot_9: 1 e_9_6 - 1 n_5 <= 0
  zup_3: 1 n_3 - 3 z_3 <= 0
  zlo_3: 1 z_3 - 1 n_3 <= 0
  tconf_0: 1 n_1 + 1 z_3 <= 1
  zup_4: 1 n_4 - 10 z_4 <= 0
  zlo_4: 1 z_4 - 1 n_4 <= 0
  tconf_1: 1 n_1 + 1 z_4 <= 1
  zup_6: 1 n_6 - 7 z_6 <= 0
  zlo_6: 1 z_6 - 1 n_6 <= 0
  tconf_2: 1 n_1 + 1 z_6 <= 1
  tconf_3: 1 z_3 + 1 z_4 <= 1
  sconf_1_3: 1 e_3_2 + 1 e_3_5 + 1 n_1 <= 1
  raw_ergo_def: 1 raw_ergo - 5 n_1 - 15 n_2 - 6 n_3 - 5 n_4 - 6 n_5 + 1 n_6 = 5
  rec_mod_def: 1 rec_mod + 0.05 n_1 + 0.1 n_2 + 0.05 n_4 + 0.1 n_5 = 0
  rec_axis_def: 1 rec_axis - 1000 rec_mod = 0
  c1_regime: 1 c1_low + 1 c1_mid + 1 c1_high = 1
  c1_lo: 1 raw_ergo + 211 c1_low <= 211
  c1_hi: 1 raw_ergo - 211 c1_high >= -111
  c1_midlo: 1 raw_ergo - 211 c1_mid >= -211
  c1_midhi: 1 raw_ergo + 211 c1_mid <= 311
  c1_zero: 1 capped_ergo + 100 c1_low <= 100
  c1_full: 1 capped_ergo - 100 c1_high >= 0
  c1_eqlo: 1 capped_ergo - 1 raw_ergo - 211 c1_mid >= -211
  c1_eqhi: 1 capped_ergo - 1 raw_ergo + 211 c1_mid <= 211
  ergo_frame: 1 ergo_axis - 10 capped_ergo = 0
  price_def: 1 price_axis - 5000 base_0 - 100 n_1 - 300 n_2 - 200 n_3 - 400 n_4 - 400 n_5 - 400 n_6 = 0
  lim_min_ergo: 1 capped_ergo >= 14
  obj_def: 1 total_obj - 0.1 ergo_axis + 1 rec_axis + 0.0001 price_axis = 0
Bounds
  0 <= n_2 <= 2
  0 <= n_3 <= 3
  0 <= n_4 <= 10
  0 <= n_6 <= 7
  0 <= e_4_4 <= 2
  0 <= e_4_6 <= 2
  0 <= e_5_4 <= 2
  0 <= e_5_6 <= 2
  0 <= e_6_3 <= 2
  0 <= e_7_4 <= 3
  0 <= e_8_4 <= 3
  4.9999999999992175 <= raw_ergo <= 110.0000000000008
  4.9999999999992175 <= capped_ergo <= 100
  -0.8500000000000068 <= rec_mod <= 6.661338147750946e-15
  -850.0000000000068 <= rec_axis <= 6.661338147750947e-12
  0 <= price_axis <= 13500.000000000015
  49.99999999999217 <= ergo_axis <= 1000.0000000000001
  3.6499999999925525 <= total_obj <= 950.0000000000072
General
  n_2 n_3 n_4 n_6 e_4_4 e_4_6 e_5_4 e_5_6 e_6_3 e_7_4 e_8_4
Binary
  base_0 n_1 n_5 e_0_1 e_1_2 e_1_3 e_1_4 e_1_5 e_2_3 e_2_6 e_3_2 e_3_5 e_4_5 e_6_5 e_9_6 z_3 z_4 z_6 c1_low c1_mid c1_high
End
