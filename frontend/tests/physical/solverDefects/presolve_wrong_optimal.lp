Maximize
  obj: total_obj
Subject To
  base_sum: 1 base_0 + 1 base_1 = 1
  slot_0: 1 x_1 + 1 x_2 <= 1
  slot_1: 1 x_3 + 1 x_4 + 1 x_5 <= 1
  slot_2: 1 x_6 + 1 x_7 <= 1
  slot_3: 1 x_8 - 1 x_1 <= 0
  slot_4: 1 x_9 + 1 x_10 - 1 x_1 <= 0
  slot_5: 1 x_11 - 1 x_3 <= 0
  req_6: 1 x_12 - 1 x_4 = 0
  slot_7: 1 x_13 - 1 x_5 <= 0
  slot_8: 1 x_14 + 1 x_15 - 1 x_5 <= 0
  req_9: 1 x_16 - 1 x_6 = 0
  slot_10: 1 x_17 - 1 x_7 <= 0
  slot_11: 1 x_18 + 1 x_19 - 1 x_7 <= 0
  req_13: 1 x_20 - 1 x_10 = 0
  slot_14: 1 x_21 - 1 x_11 <= 0
  slot_16: 1 x_23 - 1 x_12 <= 0
  req_18: 1 x_24 - 1 x_15 = 0
  slot_19: 1 x_25 - 1 x_16 <= 0
  req_21: 1 x_26 - 1 x_19 = 0
  slot_24: 1 x_27 - 1 x_23 <= 0
  slot_27: 1 x_28 - 1 x_25 <= 0
  tconf_0: 1 y_2 + 1 y_4 <= 1
  ylink_2: 1 x_2 - 1 y_2 <= 0
  ylink_8: 1 x_8 - 1 y_2 <= 0
  ylink_13: 1 x_13 - 1 y_2 <= 0
  ylink_17: 1 x_17 - 1 y_2 <= 0
  ylink_21: 1 x_21 - 1 y_2 <= 0
  ylink_27: 1 x_27 - 1 y_2 <= 0
  ylink_28: 1 x_28 - 1 y_2 <= 0
  ysum_2: 1 y_2 - 1 x_2 - 1 x_8 - 1 x_13 - 1 x_17 - 1 x_21 - 1 x_27 - 1 x_28 <= 0
  ylink_4: 1 x_4 - 1 y_4 <= 0
  ylink_6: 1 x_6 - 1 y_4 <= 0
  ylink_10: 1 x_10 - 1 y_4 <= 0
  ylink_15: 1 x_15 - 1 y_4 <= 0
  ylink_19: 1 x_19 - 1 y_4 <= 0
  ysum_4: 1 y_4 - 1 x_4 - 1 x_6 - 1 x_10 - 1 x_15 - 1 x_19 <= 0
  sconf_4_1: 2 x_4 + 1 x_3 + 1 x_5 <= 1
  sconf_6_1: 1 x_6 + 1 x_3 + 1 x_4 + 1 x_5 <= 1
  sconf_10_1: 1 x_10 + 1 x_3 + 1 x_4 + 1 x_5 <= 1
  sconf_15_1: 1 x_15 + 1 x_3 + 1 x_4 + 1 x_5 <= 1
  sconf_19_1: 1 x_19 + 1 x_3 + 1 x_4 + 1 x_5 <= 1
  incl_3: 1 x_3 + 1 x_9 + 1 x_12 + 1 x_14 + 1 x_16 + 1 x_18 + 1 x_20 + 1 x_24 + 1 x_26 >= 1
  sur_1: 1 u_1 - 1 x_1 - 1 x_5 - 1 x_7 - 1 x_11 - 1 x_23 - 1 x_25 + 1 base_1 >= 0
  cover_1: 1 lot_1_0 - 1 u_1 >= 0
  sur_2: 1 u_2 - 1 x_2 - 1 x_8 - 1 x_13 - 1 x_17 - 1 x_21 - 1 x_27 - 1 x_28 >= 0
  cover_2: 1 lot_2_0 - 1 u_2 >= 0
  sur_3: 1 u_3 - 1 x_3 - 1 x_9 - 1 x_12 - 1 x_14 - 1 x_16 - 1 x_18 - 1 x_20 - 1 x_24 - 1 x_26 >= 0
  cover_3: 1 lot_3_0 - 1 u_3 >= 0
  sur_4: 1 u_4 - 1 x_4 - 1 x_6 - 1 x_10 - 1 x_15 - 1 x_19 >= 0
  cover_4: 1 lot_4_0 + 1 lot_4_1 - 1 u_4 >= 0
  raw_ergo_def: 1 raw_ergo + 2 x_1 + 3 x_2 - 2 x_3 + 5 x_4 + 2 x_5 + 5 x_6 + 2 x_7 + 3 x_8 - 2 x_9 + 5 x_10 + 2 x_11 - 2 x_12 + 3 x_13 - 2 x_14 + 5 x_15 - 2 x_16 + 3 x_17 - 2 x_18 + 5 x_19 - 2 x_20 + 3 x_21 + 2 x_23 - 2 x_24 + 2 x_25 - 2 x_26 + 3 x_27 + 3 x_28 = 38
  rec_mod_def: 1 rec_mod + 0.125 x_1 - 0.125 x_2 - 0.09375 x_3 + 0.125 x_4 + 0.125 x_5 + 0.125 x_6 + 0.125 x_7 - 0.125 x_8 - 0.09375 x_9 + 0.125 x_10 + 0.125 x_11 - 0.09375 x_12 - 0.125 x_13 - 0.09375 x_14 + 0.125 x_15 - 0.09375 x_16 - 0.125 x_17 - 0.09375 x_18 + 0.125 x_19 - 0.09375 x_20 - 0.125 x_21 + 0.125 x_23 - 0.09375 x_24 + 0.125 x_25 - 0.09375 x_26 - 0.125 x_27 - 0.125 x_28 = 0
  rec_axis_def: 1 rec_axis - 1000 rec_mod = 0
  c1_regime: 1 c1_low + 1 c1_mid + 1 c1_high = 1
  c1_lo: 1 raw_ergo + 201 c1_low <= 201
  c1_hi: 1 raw_ergo - 201 c1_high >= -101
  c1_midlo: 1 raw_ergo - 201 c1_mid >= -201
  c1_midhi: 1 raw_ergo + 201 c1_mid <= 301
  c1_zero: 1 capped_ergo + 100 c1_low <= 100
  c1_full: 1 capped_ergo - 100 c1_high >= 0
  c1_eqlo: 1 capped_ergo - 1 raw_ergo - 201 c1_mid >= -201
  c1_eqhi: 1 capped_ergo - 1 raw_ergo + 201 c1_mid <= 201
  ergo_frame: 1 ergo_axis - 10 capped_ergo = 0
  price_def: 1 price_axis - 5500 base_0 - 5000 base_1 - 350 lot_1_0 - 100 lot_2_0 - 250 lot_3_0 - 400 lot_4_0 - 400 lot_4_1 = 0
  lim_recoil_sum: 190 rec_mod <= 10.34375
  lim_sight: 1 x_3 + 1 x_9 + 1 x_12 + 1 x_14 + 1 x_16 + 1 x_18 + 1 x_20 + 1 x_24 + 1 x_26 >= 1
  obj_def: 1 total_obj - 0.1 ergo_axis + 1 rec_axis = 0
Bounds
  0 <= u_1 <= 6
  0 <= lot_1_0 <= 6
  0 <= u_2 <= 7
  0 <= lot_2_0 <= 7
  0 <= u_3 <= 9
  0 <= lot_3_0 <= 9
  0 <= u_4 <= 5
  0 <= lot_4_0 <= 5
  0 <= lot_4_1 <= 5
  0 <= y_2 <= 1
  0 <= y_4 <= 1
  13.999999999999618 <= raw_ergo <= 40.000000000000384
  13.999999999999618 <= capped_ergo <= 40.000000000000384
  -0.4687500000000104 <= rec_mod <= 0.3125000000000104
  -468.75000000001046 <= rec_axis <= 312.50000000001046
  0 <= price_axis <= 14550.000000000015
  139.99999999999616 <= ergo_axis <= 400.0000000000039
  -298.500000000011 <= total_obj <= 508.750000000011
General
  u_1 lot_1_0 u_2 lot_2_0 u_3 lot_3_0 u_4 lot_4_0 lot_4_1
Binary
  x_1 x_2 x_3 x_4 x_5 x_6 x_7 x_8 x_9 x_10 x_11 x_12 x_13 x_14 x_15 x_16 x_17 x_18 x_19 x_20 x_21 x_23 x_24 x_25
  x_26 x_27 x_28 base_0 base_1 c1_low c1_mid c1_high
End