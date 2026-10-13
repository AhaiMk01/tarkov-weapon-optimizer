Maximize
  obj: total_obj
Subject To
  base_sum: 1 base_0 + 1 base_1 = 1
  slot_0: 1 x_1 + 1 x_2 <= 1
  slot_1: 1 x_3 + 1 x_4 + 1 x_5 <= 1
  slot_2: 1 x_6 + 1 x_7 <= 1
  slot_3: 1 x_8 - 1 x_1 <= 0
  slot_4: 1 x_9 - 1 x_5 <= 0
  slot_5: 1 x_10 + 1 x_11 + 1 x_12 - 1 x_7 <= 0
  slot_6: 1 x_13 + 1 x_14 - 1 x_8 <= 0
  slot_7: 1 x_15 - 1 x_8 <= 0
  slot_8: 1 x_16 + 1 x_17 - 1 x_9 <= 0
  slot_9: 1 x_18 - 1 x_9 <= 0
  slot_10: 1 x_19 - 1 x_10 <= 0
  slot_11: 1 x_20 - 1 x_12 <= 0
  slot_13: 1 x_21 - 1 x_14 <= 0
  slot_14: 1 x_22 - 1 x_15 <= 0
  slot_15: 1 x_23 - 1 x_17 <= 0
  slot_16: 1 x_24 - 1 x_18 <= 0
  slot_17: 1 x_25 - 1 x_19 <= 0
  sconf_4_6: 1 x_4 + 1 x_13 + 1 x_14 <= 1
  sconf_4_8: 1 x_4 + 1 x_16 + 1 x_17 <= 1
  sconf_4_11: 1 x_4 + 1 x_20 <= 1
  sconf_4_17: 1 x_4 + 1 x_25 <= 1
  sconf_11_6: 1 x_11 + 1 x_13 + 1 x_14 <= 1
  sconf_11_8: 1 x_11 + 1 x_16 + 1 x_17 <= 1
  sconf_11_11: 1 x_11 + 1 x_20 <= 1
  sconf_11_17: 1 x_11 + 1 x_25 <= 1
  sconf_21_6: 1 x_21 + 1 x_13 + 1 x_14 <= 1
  sconf_21_8: 1 x_21 + 1 x_16 + 1 x_17 <= 1
  sconf_21_11: 1 x_21 + 1 x_20 <= 1
  sconf_21_17: 1 x_21 + 1 x_25 <= 1
  sconf_22_6: 1 x_22 + 1 x_13 + 1 x_14 <= 1
  sconf_22_8: 1 x_22 + 1 x_16 + 1 x_17 <= 1
  sconf_22_11: 1 x_22 + 1 x_20 <= 1
  sconf_22_17: 1 x_22 + 1 x_25 <= 1
  sconf_23_6: 1 x_23 + 1 x_13 + 1 x_14 <= 1
  sconf_23_8: 1 x_23 + 1 x_16 + 1 x_17 <= 1
  sconf_23_11: 1 x_23 + 1 x_20 <= 1
  sconf_23_17: 1 x_23 + 1 x_25 <= 1
  sconf_24_6: 1 x_24 + 1 x_13 + 1 x_14 <= 1
  sconf_24_8: 1 x_24 + 1 x_16 + 1 x_17 <= 1
  sconf_24_11: 1 x_24 + 1 x_20 <= 1
  sconf_24_17: 1 x_24 + 1 x_25 <= 1
  sur_1: 1 u_1 - 1 x_1 - 1 x_5 - 1 x_10 + 1 base_1 >= -1
  cover_1: 1 lot_1_0 - 1 u_1 >= 0
  sur_2: 1 u_2 - 1 x_2 - 1 x_3 - 1 x_6 - 1 x_13 - 1 x_16 - 1 x_20 - 1 x_25 >= 0
  cover_2: 1 lot_2_0 - 1 u_2 >= 0
  sur_3: 1 u_3 - 1 x_4 - 1 x_11 - 1 x_21 - 1 x_22 - 1 x_23 - 1 x_24 + 1 base_1 >= -1
  cover_3: 1 lot_3_0 - 1 u_3 >= 0
  sur_4: 1 u_4 - 1 x_7 - 1 x_14 - 1 x_15 - 1 x_17 - 1 x_18 >= 0
  cover_4: 1 lot_4_0 - 1 u_4 >= 0
  sur_5: 1 u_5 - 1 x_8 - 1 x_9 - 1 x_12 - 1 x_19 >= 0
  cover_5: 1 lot_5_0 - 1 u_5 >= 0
  node_fix: 1 weight = 5.25
  raw_ergo_def: 1 raw_ergo - 3 x_1 - 7 x_2 - 7 x_3 - 11 x_4 - 3 x_5 - 7 x_6 - 7 x_7 + 5 x_8 + 5 x_9 - 3 x_10 - 11 x_11 + 5 x_12 - 7 x_13 - 7 x_14 - 7 x_15 - 7 x_16 - 7 x_17 - 7 x_18 + 5 x_19 - 7 x_20 - 11 x_21 - 11 x_22 - 11 x_23 - 11 x_24 - 7 x_25 = 0
  rec_mod_def: 1 rec_mod + 0.03125 x_1 - 0.09375 x_2 - 0.09375 x_3 + 0.1875 x_4 + 0.03125 x_5 - 0.09375 x_6 + 0.09375 x_7 + 0.0625 x_8 + 0.0625 x_9 + 0.03125 x_10 + 0.1875 x_11 + 0.0625 x_12 - 0.09375 x_13 + 0.09375 x_14 + 0.09375 x_15 - 0.09375 x_16 + 0.09375 x_17 + 0.09375 x_18 + 0.0625 x_19 - 0.09375 x_20 + 0.1875 x_21 + 0.1875 x_22 + 0.1875 x_23 + 0.1875 x_24 - 0.09375 x_25 = 0
  rec_axis_def: 1 rec_axis - 1000 rec_mod = 0
  weight_def: 1 weight - 1.5 x_1 - 1 x_2 - 1 x_3 + 0.25 x_4 - 1.5 x_5 - 1 x_6 - 0.25 x_7 - 0.75 x_8 - 0.75 x_9 - 1.5 x_10 + 0.25 x_11 - 0.75 x_12 - 1 x_13 - 0.25 x_14 - 0.25 x_15 - 1 x_16 - 0.25 x_17 - 0.25 x_18 - 0.75 x_19 - 1 x_20 + 0.25 x_21 + 0.25 x_22 + 0.25 x_23 + 0.25 x_24 - 1 x_25 = 1
  c1_regime: 1 c1_low + 1 c1_mid + 1 c1_high = 1
  c1_lo: 1 raw_ergo + 201 c1_low <= 201
  c1_hi: 1 raw_ergo - 201 c1_high >= -101
  c1_midlo: 1 raw_ergo - 201 c1_mid >= -201
  c1_midhi: 1 raw_ergo + 201 c1_mid <= 301
  c1_zero: 1 capped_ergo + 100 c1_low <= 100
  c1_full: 1 capped_ergo - 100 c1_high >= 0
  c1_eqlo: 1 capped_ergo - 1 raw_ergo - 201 c1_mid >= -201
  c1_eqhi: 1 capped_ergo - 1 raw_ergo + 201 c1_mid <= 201
  gear_def: 1 gear_ergo - 1.25 capped_ergo = 0
  c2_regime: 1 c2_low + 1 c2_mid + 1 c2_high = 1
  c2_lo: 1 gear_ergo + 208 c2_low <= 208
  c2_hi: 1 gear_ergo - 208 c2_high >= -108
  c2_midlo: 1 gear_ergo - 208 c2_mid >= -208
  c2_midhi: 1 gear_ergo + 208 c2_mid <= 308
  c2_zero: 1 eff_ergo + 100 c2_low <= 100
  c2_full: 1 eff_ergo - 100 c2_high >= 0
  c2_eqlo: 1 eff_ergo - 1 gear_ergo - 208 c2_mid >= -208
  c2_eqhi: 1 eff_ergo - 1 gear_ergo + 208 c2_mid <= 208
  ted_def: 1 ted - 1 eff_ergo = -42.857142857142854
  ergo_frame: 1 ergo_axis - 10 ted = 0
  price_def: 1 price_axis - 5000 base_0 - 4000 base_1 - 300 lot_1_0 - 400 lot_2_0 - 200 lot_3_0 - 300 lot_4_0 - 200 lot_5_0 = 0
  lim_price: 1 price_axis <= 8100
  obj_def: 1 total_obj - 0.047 ergo_axis + 1.95 rec_axis + 1.5120799999999999 price_axis = 0
Bounds
  0 <= u_1 <= 2
  0 <= lot_1_0 <= 2
  0 <= u_2 <= 7
  0 <= lot_2_0 <= 7
  0 <= u_3 <= 5
  0 <= lot_3_0 <= 5
  0 <= u_4 <= 5
  0 <= lot_4_0 <= 5
  0 <= u_5 <= 4
  0 <= lot_5_0 <= 4
  -4.000000000000558 <= raw_ergo <= 86.00000000000057
  0 <= capped_ergo <= 86.00000000000057
  -1.5937500000000082 <= rec_mod <= 0.2812500000000081
  -1593.7500000000084 <= rec_axis <= 281.2500000000082
  0 <= price_axis <= 11700.000000000013
  0.7499999999999432 <= weight <= 11.500000000000059
  0 <= gear_ergo <= 107.50000000000072
  0 <= eff_ergo <= 100
  -42.85714285714287 <= ted <= 57.14285714285716
  -428.5714285714287 <= ergo_axis <= 571.4285714285717
  -18259.916357142898 <= total_obj <= 3134.6696428571604
General
  u_1 lot_1_0 u_2 lot_2_0 u_3 lot_3_0 u_4 lot_4_0 u_5 lot_5_0
Binary
  x_1 x_2 x_3 x_4 x_5 x_6 x_7 x_8 x_9 x_10 x_11 x_12 x_13 x_14 x_15 x_16 x_17 x_18 x_19 x_20 x_21 x_22 x_23 x_24
  x_25 base_0 base_1 c1_low c1_mid c1_high c2_low c2_mid c2_high
End