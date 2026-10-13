Maximize
  obj: total_obj
Subject To
  sur_2: 1 u_2 - 1 x_3 - 1 x_7 >= 0
  cover_2: 1 lot_2_0 + 1 lot_2_1 - 1 u_2 >= 0
  price_def: 1 price_axis - 5000 base_0 - 4500 base_1 - 350 lot_1_0 - 150 lot_2_0 - 300 lot_2_1 - 100 lot_3_0 - 300 lot_3_1 - 300 lot_4_0 - 150 lot_5_0 - 300 lot_5_1 = 0
  lim_price: 1 price_axis <= 5850
  pin_base_0: base_0 = 1
  pin_t_2: x_3 + x_7 = 1
Bounds
  0 <= u_1 <= 2
  0 <= lot_1_0 <= 2
  0 <= u_2 <= 2
  0 <= lot_2_0 <= 2
  0 <= lot_2_1 <= 2
  0 <= u_3 <= 1
  0 <= lot_3_0 <= 1
  0 <= lot_3_1 <= 1
  0 <= u_4 <= 1
  0 <= lot_4_0 <= 1
  0 <= u_5 <= 1
  0 <= lot_5_0 <= 1
  0 <= lot_5_1 <= 1
  44.999999999999886 <= raw_ergo <= 74.00000000000013
  44.999999999999886 <= capped_ergo <= 74.00000000000013
  -0.6250000000000011 <= rec_mod <= 0.09375000000000103
  -625.0000000000013 <= rec_axis <= 93.75000000000104
  0 <= price_axis <= 7750.00000000001
  1.9999999999999913 <= weight <= 6.250000000000009
  449.9999999999988 <= ergo_axis <= 740.0000000000014
  -236.25000000000335 <= total_obj <= 1949.0000000000045
General
  u_1 lot_1_0 u_2 lot_2_0 lot_2_1 u_3 lot_3_0 lot_3_1 u_4 lot_4_0 u_5 lot_5_0 lot_5_1
Binary
  x_1 x_2 x_3 x_4 x_5 x_6 x_7 base_0 base_1 c1_low c1_mid c1_high
End