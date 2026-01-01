"""
Streamlit Web UI for Tarkov Weapon Mod Optimizer
"""

import altair as alt
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from weapon_optimizer import (
    fetch_all_data,
    build_item_lookup,
    build_compatibility_map,
    optimize_weapon,
    calculate_total_stats,
    explore_pareto,
)

# Page configuration
st.set_page_config(
    page_title="Tarkov Weapon Optimizer",
    page_icon="🔫",
    layout="wide",
    initial_sidebar_state="expanded",
)


# Cached data loading functions
@st.cache_data(show_spinner=False)
def load_data():
    """Fetch all guns and mods from API (cached)."""
    return fetch_all_data()


@st.cache_data(show_spinner=False)
def build_lookup(_guns, _mods):
    """Build item lookup dictionary (cached)."""
    return build_item_lookup(_guns, _mods)


def get_image_url(item_data, prefer_high_res=False, prefer_icon=False):
    """Get image URL from item data with fallback chain."""
    if prefer_icon:
        # Prefer icon for compact display
        return (
            item_data.get("iconLink")
            or item_data.get("iconLinkFallback")
            or item_data.get("imageLink")
            or item_data.get("image512pxLink")
        )
    elif prefer_high_res:
        # Prefer high-res images
        return (
            item_data.get("image512pxLink")
            or item_data.get("image8xLink")
            or item_data.get("imageLink")
            or item_data.get("iconLink")
            or item_data.get("iconLinkFallback")
        )
    else:
        # Prefer standard images
        return (
            item_data.get("imageLink")
            or item_data.get("iconLink")
            or item_data.get("image512pxLink")
            or item_data.get("iconLinkFallback")
        )


def display_mods_table(item_ids, item_lookup, show_price=True):
    """Display a markdown table of mods with their stats."""
    rows = []
    for item_id in item_ids:
        if item_id in item_lookup:
            item = item_lookup[item_id]
            stats = item["stats"]
            name = item['data']['name']
            icon_url = get_image_url(item["data"], prefer_icon=True)
            ergo = stats.get('ergonomics', 0)
            recoil = stats.get('recoil_modifier', 0) * 100

            row = {
                "icon": f"![]({icon_url})" if icon_url else "",
                "name": name,
                "ergo": f"{ergo:+.0f}" if ergo != 0 else "-",
                "recoil": f"{recoil:+.1f}%" if recoil != 0 else "-",
            }
            if show_price:
                price = stats.get('price', 0)
                price_source = stats.get('price_source', 'market')
                row["price"] = f"₽{price:,}"
                row["source"] = price_source
            rows.append(row)

    if rows:
        if show_price:
            header = "| | Name | Ergo | Recoil | Price | Source |"
            separator = "|:---:|:-----|:----:|:------:|------:|:------:|"
            lines = [header, separator]
            for row in rows:
                lines.append(f"| {row['icon']} | {row['name']} | {row['ergo']} | {row['recoil']} | {row['price']} | {row['source']} |")
        else:
            header = "| | Name | Ergo | Recoil |"
            separator = "|:---:|:-----|:----:|:------:|"
            lines = [header, separator]
            for row in rows:
                lines.append(f"| {row['icon']} | {row['name']} | {row['ergo']} | {row['recoil']} |")

        st.markdown("\n".join(lines))


def display_optimization_results(result, item_lookup, weapon_stats, presets, selected_gun, constraints=None):
    """Display optimization results. Returns True if results were displayed."""
    if result["status"] == "infeasible":
        st.error("No feasible solution found. Try adjusting constraints or budget.")
        return False

    status_icon = "✅" if result["status"] == "optimal" else "⚠️"
    st.success(f"{status_icon} Optimization {result['status'].upper()}")

    selected_items = result["selected_items"]
    selected_preset = result.get("selected_preset")

    # Calculate final stats
    final_stats = calculate_total_stats(weapon_stats, selected_items, item_lookup)

    # Display final stats
    st.subheader("Final Stats")
    col1, col2, col3, col4, col5 = st.columns(5)

    # Ergonomics
    raw_ergo = final_stats["ergonomics"]
    capped_ergo = max(0, min(100, raw_ergo))
    ergo_delta = raw_ergo - weapon_stats["naked_ergonomics"]
    with col1:
        st.metric(
            "Ergonomics",
            f"{capped_ergo:.0f}",
            f"{ergo_delta:+.0f}",
            help=f"Raw: {raw_ergo:.0f} (capped at 0-100). Delta from naked weapon.",
        )

    # Recoil Vertical
    recoil_v_delta = final_stats["recoil_vertical"] - weapon_stats["naked_recoil_v"]
    with col2:
        st.metric(
            "Recoil Vertical",
            f"{final_stats['recoil_vertical']:.1f}",
            f"{recoil_v_delta:+.1f}",
            delta_color="inverse",
            help="Delta from naked weapon.",
        )

    # Recoil Horizontal
    recoil_h_delta = final_stats["recoil_horizontal"] - weapon_stats["naked_recoil_h"]
    with col3:
        st.metric(
            "Recoil Horizontal",
            f"{final_stats['recoil_horizontal']:.1f}",
            f"{recoil_h_delta:+.1f}",
            delta_color="inverse",
            help="Delta from naked weapon.",
        )

    # Total Weight
    base_weight = weapon_stats.get("weight", 0)
    weight_delta = final_stats["total_weight"] - base_weight
    with col4:
        st.metric(
            "Total Weight",
            f"{final_stats['total_weight']:.2f} kg",
            f"{weight_delta:+.2f} kg",
            delta_color="inverse",
            help=f"Base weapon: {base_weight:.2f} kg",
        )

    # Total Cost (including preset if selected, or naked gun + mods)
    total_cost = final_stats['total_price']
    weapon_base_price = weapon_stats.get("price", 0)

    if selected_preset:
        preset_info_temp = next((p for p in presets if p.get("id") == selected_preset), None)
        if preset_info_temp:
            preset_items_temp = set(preset_info_temp.get("items", []))
            individual_cost = sum([
                item_lookup[item_id]["stats"].get("price", 0)
                for item_id in selected_items
                if item_id not in preset_items_temp and item_id in item_lookup
            ])
            total_cost = preset_info_temp.get("price", 0) + individual_cost
    else:
        total_cost = weapon_base_price + final_stats['total_price']

    with col5:
        st.metric(
            "Total Build Cost",
            f"₽{total_cost:,}",
            help="Total cost including weapon base and all modifications",
        )

    # Display selected mods
    st.markdown("---")
    st.subheader("Selected Build")

    # Get preset info and items if preset was selected
    preset_info = None
    preset_item_ids = set()
    if selected_preset:
        preset_info = next((p for p in presets if p.get("id") == selected_preset), None)
        if preset_info:
            preset_item_ids = set(preset_info.get("items", []))

    if selected_preset and preset_info:
        st.markdown(f"**Preset:** {preset_info.get('name')}")
        col1, col2 = st.columns([3, 1])
        with col1:
            st.markdown(f"**Bundle Price:** ₽{preset_info.get('price', 0):,} ({preset_info.get('price_source', 'market')})")
            st.markdown(f"**Includes:** {len(preset_item_ids)} items")
        with col2:
            if preset_info.get("image"):
                st.image(preset_info["image"], width=150)

        additional_items = [item_id for item_id in selected_items if item_id not in preset_item_ids]
        if additional_items:
            st.markdown("---")
            st.markdown("**Additional Mods:**")
            display_mods_table(additional_items, item_lookup, show_price=True)

        with st.expander(f"Items in {preset_info.get('name')} preset", expanded=False):
            display_mods_table(preset_item_ids, item_lookup, show_price=False)

    elif selected_items:
        st.markdown("**Naked Gun + Individual Mods**")

        col1, col2 = st.columns([3, 1])
        with col1:
            st.markdown(f"**Base Weapon:** {selected_gun['name']}")
            weapon_price = weapon_stats.get('price', 0)
            weapon_source = weapon_stats.get('price_source', 'market')

            if weapon_source == "not_available":
                st.markdown("**Price:** Not Available (presets only)")
            else:
                st.markdown(f"**Price:** ₽{weapon_price:,} ({weapon_source})")
        with col2:
            weapon_image_url = weapon_stats.get("default_preset_image") or get_image_url(selected_gun, prefer_high_res=True)
            if weapon_image_url:
                st.image(weapon_image_url, width=150)

        if selected_items:
            st.markdown("---")
            st.markdown("**Additional Mods:**")
            display_mods_table(selected_items, item_lookup, show_price=True)
    else:
        st.markdown("**Naked Gun**")
        col1, col2 = st.columns([3, 1])
        with col1:
            st.markdown(f"**Base Weapon:** {selected_gun['name']}")
            weapon_price = weapon_stats.get('price', 0)
            weapon_source = weapon_stats.get('price_source', 'market')

            if weapon_source == "not_available":
                st.markdown("**Price:** Not Available (presets only)")
            else:
                st.markdown(f"**Price:** ₽{weapon_price:,} ({weapon_source})")

            st.info("No modifications selected")
        with col2:
            weapon_image_url = weapon_stats.get("default_preset_image") or get_image_url(selected_gun, prefer_high_res=True)
            if weapon_image_url:
                st.image(weapon_image_url, width=150)

    # Optimization details
    with st.expander("Optimization Details"):
        st.write(f"**Status:** {result['status']}")
        st.write(f"**Objective Value:** {result['objective_value']:.0f}")
        st.write(f"**Recoil Multiplier:** {final_stats['recoil_multiplier']:.4f}")
        if constraints:
            if constraints.get("max_price"):
                st.write(f"**Budget Constraint:** ₽{constraints['max_price']:,}")
            if constraints.get("min_ergonomics"):
                st.write(f"**Min Ergonomics Constraint:** {constraints['min_ergonomics']}")
            if constraints.get("max_recoil_v"):
                st.write(f"**Max Recoil V Constraint:** {constraints['max_recoil_v']}")

    return True


def main():
    # Title
    st.title("🔫 Tarkov Weapon Mod Optimizer")
    st.markdown("Optimize your weapon builds using constraint programming")

    # Load data with spinner
    with st.spinner("Loading weapon and mod data from Tarkov.dev API..."):
        try:
            guns, mods = load_data()
            item_lookup = build_lookup(guns, mods)
        except Exception as e:
            st.error(f"Failed to load data from API: {e}")
            st.stop()

    st.success(f"Loaded {len(guns)} guns and {len(mods)} mods")

    # Sidebar: Weapon Selection only
    st.sidebar.header("🔫 Select Weapon")

    gun_options = {gun["name"]: gun for gun in guns}
    gun_names = sorted(gun_options.keys())

    selected_gun_name = st.sidebar.selectbox(
        "Choose a weapon:",
        gun_names,
        help="Select the base weapon to optimize",
    )

    selected_gun = gun_options[selected_gun_name]
    weapon_id = selected_gun["id"]
    weapon_stats = item_lookup[weapon_id]["stats"]
    presets = item_lookup[weapon_id]["presets"]

    # Display weapon image (always use defaultPreset grid image)
    weapon_image_url = weapon_stats.get("default_preset_image") or get_image_url(selected_gun, prefer_high_res=True)
    if weapon_image_url:
        st.sidebar.image(weapon_image_url, width="stretch")

    # Show base weapon stats
    st.sidebar.markdown("**Base Stats:**")
    st.sidebar.markdown(f"- Ergonomics: {weapon_stats.get('naked_ergonomics', 0):.0f}")
    st.sidebar.markdown(f"- Recoil V: {weapon_stats.get('naked_recoil_v', 0):.0f}")
    st.sidebar.markdown(f"- Recoil H: {weapon_stats.get('naked_recoil_h', 0):.0f}")

    # Show all presets info
    if presets:
        with st.sidebar.expander(f"📦 Available Presets ({len(presets)})"):
            for preset in presets:
                preset_name = preset.get("name", "Unknown")
                preset_price = preset.get("price", 0)
                preset_items = preset.get("items", [])
                st.markdown(f"**{preset_name}**")
                st.markdown(f"  - Price: ₽{preset_price:,}")
                st.markdown(f"  - Items: {len(preset_items)}")
                st.markdown("---")

    # Create tabs for Explore and Optimize
    tab_explore, tab_optimize = st.tabs(["📊 Explore Trade-offs", "🚀 Optimize Build"])

    # ==================== EXPLORE TAB ====================
    with tab_explore:
        st.header("Explore Trade-off Curves")
        st.markdown("Discover the Pareto frontier to understand what's achievable before optimizing.")

        # Exploration settings in columns
        col1, col2 = st.columns([2, 1])
        with col1:
            explore_tradeoff = st.selectbox(
                "Trade-off to explore:",
                ["Ergo vs Recoil (ignore price)", "Ergo vs Price (ignore recoil)", "Recoil vs Price (ignore ergo)"],
                help="Select which two dimensions to explore",
            )

        # Constraints for exploration
        st.subheader("Constraints (optional)")
        exp_col1, exp_col2, exp_col3 = st.columns(3)

        with exp_col1:
            exp_enable_budget = st.checkbox("Budget Limit", key="exp_budget_check")
            exp_max_price = None
            if exp_enable_budget:
                exp_max_price = st.number_input(
                    "Max Budget (₽)",
                    min_value=0,
                    max_value=10000000,
                    value=500000,
                    step=50000,
                    key="exp_max_price",
                )

        with exp_col2:
            exp_enable_min_ergo = st.checkbox("Min Ergonomics", key="exp_ergo_check")
            exp_min_ergo = None
            if exp_enable_min_ergo:
                exp_min_ergo = st.slider("Min Ergo", 0, 100, 50, key="exp_min_ergo")

        with exp_col3:
            naked_recoil = weapon_stats.get("naked_recoil_v", 100)
            exp_enable_max_recoil = st.checkbox("Max Recoil", key="exp_recoil_check")
            exp_max_recoil = None
            if exp_enable_max_recoil:
                exp_max_recoil = st.slider("Max Recoil V", 20, int(naked_recoil), int(naked_recoil * 0.7), key="exp_max_recoil")

        # Explore button
        explore_button = st.button("📊 Explore Trade-offs", type="primary", key="explore_btn")

        if explore_button:
            # Build compatibility map
            with st.spinner("Building compatibility map..."):
                try:
                    compat_map = build_compatibility_map(weapon_id, item_lookup)
                except Exception as e:
                    st.error(f"Failed to build compatibility map: {e}")
                    st.stop()

            with st.spinner("Exploring trade-off curve (this may take a moment)..."):
                try:
                    ignore_map = {
                        "Ergo vs Recoil (ignore price)": "price",
                        "Ergo vs Price (ignore recoil)": "recoil",
                        "Recoil vs Price (ignore ergo)": "ergo",
                    }
                    frontier = explore_pareto(
                        weapon_id,
                        item_lookup,
                        compat_map,
                        ignore=ignore_map[explore_tradeoff],
                        max_price=exp_max_price,
                        min_ergonomics=exp_min_ergo,
                        max_recoil_v=exp_max_recoil,
                        steps=8,
                    )
                except Exception as e:
                    st.error(f"Exploration failed: {e}")
                    st.stop()

            if not frontier:
                st.error("No feasible builds found within constraints.")
            else:
                ignore = ignore_map[explore_tradeoff]

                if ignore == "price":
                    chart_x, chart_y = "Ergonomics", "Recoil V"
                    x_data = [p["ergo"] for p in frontier]
                    y_data = [p["recoil_v"] for p in frontier]
                    tip = "Each row shows the best recoil at that ergo level."
                elif ignore == "recoil":
                    chart_x, chart_y = "Ergonomics", "Price (₽)"
                    x_data = [p["ergo"] for p in frontier]
                    y_data = [p["price"] for p in frontier]
                    tip = "Each row shows the lowest price at that ergo level."
                else:
                    chart_x, chart_y = "Recoil V", "Price (₽)"
                    x_data = [p["recoil_v"] for p in frontier]
                    y_data = [p["price"] for p in frontier]
                    tip = "Each row shows the lowest price at that recoil level."

                # Show active constraints
                constraints = []
                if exp_max_price:
                    constraints.append(f"Budget ≤ ₽{exp_max_price:,}")
                if exp_min_ergo:
                    constraints.append(f"Ergo ≥ {exp_min_ergo}")
                if exp_max_recoil:
                    constraints.append(f"Recoil V ≤ {exp_max_recoil}")
                if constraints:
                    st.info(f"Active constraints: {', '.join(constraints)}")

                # Line chart
                chart_df = pd.DataFrame({chart_x: x_data, chart_y: y_data})
                chart = alt.Chart(chart_df).mark_line(point=True).encode(
                    x=alt.X(chart_x, scale=alt.Scale(zero=False)),
                    y=alt.Y(chart_y, scale=alt.Scale(zero=False)),
                    tooltip=[chart_x, chart_y]
                ).properties(height=300)
                st.altair_chart(chart, width="stretch")

                # Display as table
                # Table header
                cols = st.columns([1, 1.5, 1.5, 1.5, 2])
                cols[0].markdown("**Ergo**")
                cols[1].markdown("**Recoil %**")
                cols[2].markdown("**Recoil V**")
                cols[3].markdown("**Recoil H**")
                cols[4].markdown("**Price**")

                for point in frontier:
                    cols = st.columns([1, 1.5, 1.5, 1.5, 2])
                    cols[0].write(f"{point['ergo']}")
                    cols[1].write(f"{point['recoil_pct']:+.1f}%")
                    cols[2].write(f"{point['recoil_v']:.1f}")
                    cols[3].write(f"{point['recoil_h']:.1f}")
                    cols[4].write(f"₽{point['price']:,}")

                st.caption(tip)

    # ==================== OPTIMIZE TAB ====================
    with tab_optimize:
        st.header("Optimize Your Build")

        # Two columns: Weights on left, Constraints on right
        opt_col1, opt_col2 = st.columns(2)

        with opt_col1:
            st.subheader("Optimization Weights")

            # Initialize weights in session state if not present
            if "weight_ergo" not in st.session_state:
                st.session_state.weight_ergo = 33
            if "weight_recoil" not in st.session_state:
                st.session_state.weight_recoil = 67
            if "weight_price" not in st.session_state:
                st.session_state.weight_price = 0

            # Preset buttons
            preset_cols = st.columns(3)
            if preset_cols[0].button("Ergo", help="Pure ergonomics", key="preset_ergo"):
                st.session_state.weight_ergo = 100
                st.session_state.weight_recoil = 0
                st.session_state.weight_price = 0
                st.rerun()
            if preset_cols[1].button("Recoil", help="Pure recoil", key="preset_recoil"):
                st.session_state.weight_ergo = 0
                st.session_state.weight_recoil = 100
                st.session_state.weight_price = 0
                st.rerun()
            if preset_cols[2].button("Price", help="Pure price", key="preset_price"):
                st.session_state.weight_ergo = 0
                st.session_state.weight_recoil = 0
                st.session_state.weight_price = 100
                st.rerun()

            # Get current weights from session state
            w_ergo = st.session_state.weight_ergo
            w_recoil = st.session_state.weight_recoil
            w_price = st.session_state.weight_price

            # Create ternary plot
            fig = go.Figure()

            # Generate clickable grid points
            grid_a, grid_b, grid_c = [], [], []
            for a in range(0, 101, 10):
                for b in range(0, 101 - a, 10):
                    c = 100 - a - b
                    grid_a.append(a)
                    grid_b.append(b)
                    grid_c.append(c)

            # Add clickable grid
            fig.add_trace(go.Scatterternary(
                a=grid_a,
                b=grid_b,
                c=grid_c,
                mode='markers',
                marker=dict(size=8, color='lightgray', opacity=0.3),
                hovertemplate="Ergo: %{a}%<br>Recoil: %{b}%<br>Price: %{c}%<extra></extra>",
                showlegend=False,
            ))

            # Add current position marker
            fig.add_trace(go.Scatterternary(
                a=[w_ergo],
                b=[w_recoil],
                c=[w_price],
                mode='markers',
                marker=dict(size=18, color='red', symbol='circle', line=dict(width=2, color='white')),
                name='Current',
                hovertemplate="<b>Current</b><br>Ergo: %{a}%<br>Recoil: %{b}%<br>Price: %{c}%<extra></extra>",
            ))

            # Add corner labels
            fig.add_trace(go.Scatterternary(
                a=[100, 0, 0],
                b=[0, 100, 0],
                c=[0, 0, 100],
                mode='text',
                text=['Ergo', 'Recoil', 'Price'],
                textposition=['top center', 'bottom left', 'bottom right'],
                textfont=dict(size=11, color='gray'),
                showlegend=False,
                hoverinfo='skip',
            ))

            fig.update_layout(
                ternary=dict(
                    sum=100,
                    aaxis=dict(title="", showticklabels=False, linewidth=1),
                    baxis=dict(title="", showticklabels=False, linewidth=1),
                    caxis=dict(title="", showticklabels=False, linewidth=1),
                ),
                showlegend=False,
                margin=dict(l=30, r=30, t=30, b=10),
                height=280,
            )

            # Display chart with click selection
            event = st.plotly_chart(
                fig,
                width="stretch",
                on_select="rerun",
                selection_mode="points",
                key="ternary_weights",
            )

            # Handle click events
            if event and event.selection and event.selection.get("points"):
                point = event.selection["points"][0]
                if "a" in point and "b" in point and "c" in point:
                    new_a = round(point["a"])
                    new_b = round(point["b"])
                    new_c = round(point["c"])
                    if (new_a, new_b, new_c) != (w_ergo, w_recoil, w_price):
                        st.session_state.weight_ergo = new_a
                        st.session_state.weight_recoil = new_b
                        st.session_state.weight_price = new_c
                        st.rerun()

            st.caption(f"Ergo: {w_ergo}% | Recoil: {w_recoil}% | Price: {w_price}%")

            # Convert percentages to weights
            total = w_ergo + w_recoil + w_price
            if total > 0:
                ergo_weight = (w_ergo / 100) * 2
                recoil_weight = (w_recoil / 100) * 2
                price_weight = (w_price / 100) * 2
            else:
                ergo_weight, recoil_weight, price_weight = 1.0, 1.0, 0.0

        with opt_col2:
            st.subheader("Constraints")

            # Budget constraint
            enable_budget = st.checkbox("Budget Limit", key="opt_budget_check")
            max_price = None
            if enable_budget:
                max_price = st.number_input(
                    "Max Budget (₽)",
                    min_value=0,
                    max_value=10000000,
                    value=500000,
                    step=50000,
                    help="Maximum total build cost",
                    key="opt_max_price",
                )

            # Minimum ergonomics constraint
            enable_min_ergo = st.checkbox("Minimum Ergonomics", key="opt_ergo_check")
            min_ergonomics = None
            if enable_min_ergo:
                min_ergonomics = st.slider(
                    "Min Ergo",
                    min_value=0,
                    max_value=100,
                    value=50,
                    help="Minimum final ergonomics required",
                    key="opt_min_ergo",
                )

            # Maximum recoil constraint
            enable_max_recoil = st.checkbox("Maximum Recoil", key="opt_recoil_check")
            max_recoil_v = None
            if enable_max_recoil:
                naked_recoil = weapon_stats.get("naked_recoil_v", 100)
                max_recoil_v = st.slider(
                    "Max Recoil V",
                    min_value=20,
                    max_value=int(naked_recoil),
                    value=int(naked_recoil * 0.7),
                    help=f"Maximum final vertical recoil (naked: {naked_recoil:.0f})",
                    key="opt_max_recoil",
                )

        # Optimize button
        st.markdown("---")
        optimize_button = st.button("🚀 Optimize Build", type="primary", key="optimize_btn", width="stretch")

        if optimize_button:
            # Build compatibility map
            with st.spinner("Building compatibility map..."):
                try:
                    compat_map = build_compatibility_map(weapon_id, item_lookup)
                except Exception as e:
                    st.error(f"Failed to build compatibility map: {e}")
                    st.stop()

            st.info(f"Found {len(compat_map['reachable_items'])} compatible mods")

            # Run optimization
            with st.spinner("Running optimization (CP-SAT solver)..."):
                try:
                    result = optimize_weapon(
                        weapon_id,
                        item_lookup,
                        compat_map,
                        max_price=max_price,
                        min_ergonomics=min_ergonomics,
                        max_recoil_v=max_recoil_v,
                        ergo_weight=ergo_weight,
                        recoil_weight=recoil_weight,
                        price_weight=price_weight,
                    )
                except Exception as e:
                    st.error(f"Optimization failed: {e}")
                    st.stop()

            # Display results
            constraints = {
                "max_price": max_price,
                "min_ergonomics": min_ergonomics,
                "max_recoil_v": max_recoil_v,
            }
            display_optimization_results(
                result, item_lookup, weapon_stats, presets, selected_gun, constraints
            )

        else:
            # Initial state for Optimize tab
            st.info("Configure weights and constraints above, then click **Optimize Build**.")
            st.markdown("""
            **How it works:**
            1. Set your priority weights using the triangle chart (click grid points)
            2. Optionally set hard constraints (budget, min ergo, max recoil)
            3. Click **Optimize Build** to find the best mod configuration

            **Tip:** Use the **Explore Trade-offs** tab first to understand what's achievable!
            """)


if __name__ == "__main__":
    main()
