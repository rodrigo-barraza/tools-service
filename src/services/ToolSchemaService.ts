// ─── Single Source of Truth ─────────────────────────────────

import { queryEmojiCombination } from "../caches/EmojiKitchenCache.ts";

import type {
  ToolDefinition,
  ToolIntelligenceTier,
  ToolParameters,
  ToolParameterProperty,
  ToolSchema,
  ToolSchemaForAI,
} from "../types/tools.ts";

import { DOMAINS } from "@rodrigo-barraza/utilities-library/taxonomy";
import PromptLocaleService from "./PromptLocaleService.ts";

// Reverse map: domain display name → programmatic key (e.g. "Core Harness Tools" → "core_harness")
const DOMAIN_DISPLAY_NAME_TO_KEY = new Map<string, string>();
for (const entry of Object.values(DOMAINS)) {
  if (!DOMAIN_DISPLAY_NAME_TO_KEY.has(entry.displayName)) {
    DOMAIN_DISPLAY_NAME_TO_KEY.set(entry.displayName, entry.key);
  }
}

function resolveDomainKey(domain: string): string {
  return (
    DOMAIN_DISPLAY_NAME_TO_KEY.get(domain) ||
    domain
      .toLowerCase()
      .replace(new RegExp("[^a-z0-9]+", "g"), "_")
      .replace(/^_|_$/g, "")
  );
}

// ────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────
// Decomposed Tool Definitions & Fields
// ────────────────────────────────────────────────────────────

import { createToolDefinitions, FIELDS } from "./tool-definitions/index.ts";

function createLocalizedToolDefinitions(
  translate: (key: string, variables?: Record<string, string>) => string
): ToolDefinition[] {
  return createToolDefinitions(translate);
}

// Per-locale definition cache — rebuilt once per locale, never on hot path
const localizedDefinitionsCache = new Map<string, ToolDefinition[]>();

export function getLocalizedToolDefinitions(locale: string): ToolDefinition[] {
  let definitions = localizedDefinitionsCache.get(locale);
  if (!definitions) {
    const translate = (key: string, variables?: Record<string, string>) =>
      PromptLocaleService.get(locale, `tools.${key}`, variables);
    definitions = createLocalizedToolDefinitions(translate);
    localizedDefinitionsCache.set(locale, definitions);
  }
  return definitions;
}

// Default English definitions — backwards-compatible direct access
const TOOL_DEFINITIONS: ToolDefinition[] = getLocalizedToolDefinitions(PromptLocaleService.getDefaultLocale());



// ────────────────────────────────────────────────────────────
// Domain Taxonomy — groups tools by functional area
// ────────────────────────────────────────────────────────────

const TOOL_DOMAINS = {
  // Weather & Environment
  get_weather: "Weather & Environment",
  get_local_environment: "Weather & Environment",
  get_weather_forecast: "Weather & Environment",
  get_canada_avalanche_forecast: "Weather & Environment",
  get_earthquakes: "Weather & Environment",
  get_solar_activity: "Weather & Environment",
  get_aurora_forecast: "Weather & Environment",
  get_solar_wind: "Weather & Environment",
  get_twilight: "Weather & Environment",
  get_tides: "Weather & Environment",
  get_wildfires: "Weather & Environment",
  get_iss_location: "Weather & Environment",
  get_near_earth_objects: "Weather & Environment",
  get_space_launches: "Weather & Environment",
  get_nasa_apod: "Weather & Environment",
  get_canada_weather_warnings: "Weather & Environment",
  get_detailed_air_quality: "Weather & Environment",
  get_weather_history: "Weather & Environment",
  get_weather_marine: "Weather & Environment",
  get_weather_astronomy: "Weather & Environment",
  get_weather_alerts: "Weather & Environment",
  get_moon_phase: "Weather & Environment",

  // Events
  get_events: "Events",

  // Sports
  get_live_scores: "Sports",
  get_upcoming_matches: "Sports",
  get_recent_results: "Sports",
  get_league_standings: "Sports",
  get_match_details: "Sports",
  get_head_to_head: "Sports",
  search_teams: "Sports",
  search_players: "Sports",
  get_team_squad: "Sports",
  get_league_top_scorers: "Sports",

  // Markets & Commodities
  get_commodities: "Markets & Commodities",

  // Trends
  get_trends: "Trends",

  // Products
  search_products: "Products",
  get_trending_products: "Products",
  get_watchlist_availability: "Products",
  check_sku_availability: "Products",
  get_costco_us_products: "Products",
  get_costco_ca_products: "Products",
  search_amazon_products: "Products",

  // Finance
  get_stock: "Finance",
  get_macro: "Finance",
  get_market_news: "Finance",
  get_earnings_calendar: "Finance",
  get_historical_prices: "Finance",
  get_technical_analysis: "Finance",
  get_volatility: "Finance",
  get_fear_greed_index: "Finance",
  get_sec_filings: "Finance",
  get_sector_performance: "Finance",

  // Knowledge
  search_books: "Knowledge",
  search_library_docs: "Knowledge",
  get_country: "Knowledge",
  get_element: "Knowledge",
  get_exoplanet: "Knowledge",
  get_anime: "Knowledge",
  get_word_definition: "Knowledge",
  search_papers: "Knowledge",
  get_wikipedia_summary: "Knowledge",
  get_on_this_day: "Knowledge",
  list_development_indicators: "Knowledge",
  search_youtube: "Knowledge",
  get_youtube_video: "Knowledge",
  download_video: "Knowledge",
  trim_video: "Knowledge",
  read_url: "Core Harness Tools",
  get_package_info: "Knowledge",

  read_rss_feed: "Knowledge",
  get_pypi_package: "Knowledge",

  // Classifieds & Marketplaces
  search_craigslist: "Knowledge",
  search_kijiji: "Knowledge",
  search_autotrader: "Knowledge",
  search_ebay: "Products",
  search_etsy: "Products",

  // Music (Spotify)
  search_spotify: "Knowledge",
  get_spotify: "Knowledge",
  control_spotify: "Knowledge",

  // Reddit
  search_reddit: "Reddit",
  search_reddit_subreddits: "Reddit",
  get_reddit_subreddit_info: "Reddit",
  get_reddit_subreddit_feed: "Reddit",
  get_reddit_subreddit_rules: "Reddit",
  get_reddit_subreddit_wiki_pages: "Reddit",
  get_reddit_subreddit_wiki_page: "Reddit",
  get_reddit_user_history: "Reddit",
  get_reddit_user_profile: "Reddit",


  // Movies & TV
  search_media: "Movies & TV",
  get_media_details: "Movies & TV",
  get_media_credits: "Movies & TV",
  get_trending_media: "Movies & TV",
  browse_media: "Movies & TV",
  get_media_genres: "Movies & TV",
  get_now_playing_media: "Movies & TV",
  get_media_recommendations: "Movies & TV",
  search_person: "Movies & TV",
  get_watch_providers: "Movies & TV",

  // Health
  search_drugs: "Health",
  get_drug_adverse_events: "Health",
  get_drug_recalls: "Health",
  search_food_nutrition: "Health",
  rank_foods_by_nutrient: "Health",
  compare_food_nutrition: "Health",
  get_nutrition_reference: "Health",
  get_nutritional_requirements: "Health",
  list_drug_dosage_forms: "Health",
  search_gym_exercises: "Health",
  get_gym_exercise_categories: "Health",
  get_gym_exercise_by_id: "Health",
  calculate_caloric_needs: "Health",
  analyze_nutrient_gaps: "Health",
  search_food_substitutes: "Health",
  estimate_exercise_calories: "Health",
  calculate_hydration_needs: "Health",
  build_meal_plan: "Health",
  check_drug_nutrient_interactions: "Health",
  get_pollen_forecast: "Health",

  // Transit
  get_translink_next_bus: "Transit",
  get_translink_stop_info: "Transit",
  search_translink_stops_nearby: "Transit",
  get_translink_route_info: "Transit",

  // Utilities
  search_airports: "Utilities",
  evaluate_expression: "Core Harness Tools",
  convert_currency: "Utilities",
  get_time_in_timezone: "Utilities",
  get_ip_info: "Utilities",
  search_nearby_places: "Utilities",
  search_places: "Utilities",
  generate_map: "Utilities",
  generate_chart: "Utilities",
  get_public_webcams: "Utilities",
  // Compute
  execute_python: "Core Harness Tools",
  execute_javascript: "Core Harness Tools",
  execute_shell: "Compute",
  convert_units: "Compute",
  parse_datetime: "Compute",
  transform_json: "Compute",
  generate_csv: "Compute",
  render_latex: "Compute",
  generate_diagram: "Compute",
  diff_text: "Compute",
  generate_hash: "Compute",
  test_regex: "Compute",
  convert_encoding: "Compute",
  convert_video_to_gif: "Compute",
  parse_cron_expression: "Compute",
  think: "Core Harness Tools",
  sleep: "Core Harness Tools",
  emit_structured_output: "Core Harness Tools",

  // Gaming
  get_dota: "Gaming",
  get_steam_profile: "Gaming",
  create_bonfire: "Gaming",

  // Music
  get_music: "Knowledge",

  // Wayback Machine
  get_wayback_snapshot: "Knowledge",

  // Torrent
  search_torrents: "Torrent",
  download_torrent: "Torrent",
  get_torrent_status: "Torrent",

  // Maritime
  get_tracked_vessels: "Maritime",
  get_vessel_by_mmsi: "Maritime",
  search_vessels: "Maritime",
  get_vessels_in_area: "Maritime",
  get_ais_messages: "Maritime",

  // Energy
  get_energy_indicators: "Energy",
  get_energy_catalog: "Energy",
  get_energy_facets: "Energy",
  search_energy: "Energy",
  get_electricity_retail_sales: "Energy",
  get_petroleum_prices: "Energy",
  get_natural_gas_prices: "Energy",

  // Agentic — Workspace
  read_file: "Core Workspace Tools",
  write_file: "Core Workspace Tools",
  replace_in_file: "Core Workspace Tools",
  apply_patch: "Core Workspace Tools",
  code_intel: "Core Workspace Tools",
  read_files: "Core Workspace Tools",
  get_file_info: "Core Workspace Tools",
  move_file: "Core Workspace Tools",
  delete_file: "Core Workspace Tools",

  // Agentic — Workspace Search
  list_directory: "Core Workspace Tools",
  search_file_contents: "Core Workspace Tools",
  find_files: "Core Workspace Tools",
  summarize_project: "Core Workspace Tools",

  // Agentic — Web
  read_web_page: "Web",
  read_pdf: "Web",
  read_image_text: "Web",
  read_docx: "Web",
  read_spreadsheet: "Web",
  read_csv: "Web",
  search_web: "Core Harness Tools",
  search_news: "Web",
  search_images: "Web",
  search_videos: "Web",

  // Agentic — Command Execution
  execute_command: "Core Workspace Tools",
  get_background_output: "Core Workspace Tools",
  list_background_processes: "Core Workspace Tools",
  kill_process: "Core Workspace Tools",

  // Agentic — Git

  run_git: "Core Workspace Tools",
  // Agentic — Browser Automation
  control_browser: "Browser",
  execute_browser_script: "Browser",

  // Agentic — Task Management
  create_task: "Core Task Tools",
  get_task: "Core Task Tools",
  list_tasks: "Core Task Tools",
  update_task: "Core Task Tools",

  // Agentic — Memory Persistence
  save_memory: "Core Harness Tools",

  // Agentic — Structured Datastore
  write_datastore: "Core Harness Tools",
  query_datastore: "Core Harness Tools",
  delete_datastore: "Core Harness Tools",

  // Agentic — Agent Management
  create_custom_agent: "Agent Management",
  list_custom_agents: "Agent Management",
  list_agents: "Agent Management",
  update_custom_agent: "Agent Management",


  // Agentic — Tool Discovery
  search_tools: "Core Discover Tools",

  // Core Schedule Tools
  create_cron: "Core Schedule Tools",
  remote_trigger: "Core Schedule Tools",
  create_cron_job: "Core Schedule Tools",
  list_cron_jobs: "Core Schedule Tools",
  delete_cron_job: "Core Schedule Tools",
  trigger_cron_job: "Core Schedule Tools",

  // Agentic — Notebook Editing
  edit_notebook: "Core Workspace Tools",

  // Agentic — Debugging & Commit Splitting
  debug: "Core Workspace Tools",
  commit_split: "Core Workspace Tools",

  // Communication (Twilio)
  send_email: "Communication",
  search_email: "Communication",
  read_email: "Communication",
  send_sms: "Communication",
  list_sms_messages: "Communication",
  get_sms_account: "Communication",
  lookup_phone_number: "Communication",
  list_phone_numbers: "Communication",

  // Creative (Image Generation, Vision, Audio, 3D, Visual)
  get_emoji_combination: "Creative",
  get_emoji_combinations: "Creative",
  generate_image: "Creative",
  describe_image: "Creative",
  detect_objects: "Creative",
  remove_background: "Creative",
  synthesize_speech: "Creative",
  synthesize_speech_local: "Creative",
  generate_audio: "Creative",
  remix_audio: "Creative",
  create_vector_animation: "Creative",
  transcribe_audio: "Creative",
  generate_qr_code: "Creative",
  scan_barcode: "Creative",
  render_code: "Creative",
  generate_avatar: "Creative",
  generate_ascii_banner: "Creative",
  convert_color: "Creative",
  manipulate_image: "Creative",
  convert_image_to_ascii: "Creative",
  draw_turtle_graphics: "Creative",
  create_3d_mesh: "Creative",
  create_3d_scene: "Creative",
  create_3d_voxel: "Creative",

  // Discord (Lupos DB)
  search_discord_messages: "Discord",
  get_discord_message_analytics: "Discord",
  get_discord_server_activity: "Discord",
  get_discord_guild_channels: "Discord",
  get_discord_guild_members: "Discord",
  get_discord_guild_emojis: "Discord",
  get_bot_stats: "Discord",
  get_bot_guilds: "Discord",
  get_bot_activity_timeline: "Discord",
  get_discord_user_heatmap_data: "Discord",
  get_discord_mention_leaderboard: "Discord",
  get_discord_message_leaderboard: "Discord",
  get_discord_word_frequencies: "Discord",
  react_to_discord_message: "Discord",
  get_discord_voice_channel_members: "Discord",
  get_discord_user_profile: "Discord",
  get_discord_channel_activity_stats: "Discord",
  get_discord_gold_balance: "Discord",
  give_discord_gold: "Discord",
  mug_discord_gold: "Discord",

  // Smart Home (LIFX Lights)
  list_lights: "Smart Home",
  set_light_state: "Smart Home",
  toggle_light_power: "Smart Home",
  start_light_breathe_effect: "Smart Home",
  start_light_pulse_effect: "Smart Home",
  start_light_move_effect: "Smart Home",
  start_light_flame_effect: "Smart Home",
  start_light_morph_effect: "Smart Home",
  set_light_states: "Smart Home",
  paint_lights_from_image: "Smart Home",
  adjust_light_state: "Smart Home",
  stop_light_effects: "Smart Home",
  list_light_scenes: "Smart Home",
  activate_light_scene: "Smart Home",
  enable_light_night_lock: "Smart Home",
  get_light_health: "Smart Home",

  // Network Intelligence
  dns_lookup: "Network Intelligence",
  whois_lookup: "Network Intelligence",
  ssl_certificate_check: "Network Intelligence",
  port_scan: "Network Intelligence",
  http_headers: "Network Intelligence",
  ping_host: "Network Intelligence",

  // Security
  check_breach: "Security",

  // Communication (new tools)
  send_push_notification: "Communication",
  send_webhook: "Communication",

  // Calendar
  get_calendar_events: "Calendar",
  create_calendar_event: "Calendar",
  get_free_busy: "Calendar",

  // Trends (new tool)
  get_github_trending: "Trends",

  // Compute (new tools)
  analyze_csv: "Compute",
  compare_json: "Compute",
  validate_json_schema: "Compute",

  // Knowledge (new tools)
  get_stackoverflow_questions: "Knowledge",
  search_patents: "Knowledge",

  // Weather & Environment (new tool)
  get_satellite_imagery: "Weather & Environment",

  // Transit (new tool)
  get_flight_status: "Transit",

  // Infrastructure Observability
  get_infrastructure_status: "Infrastructure",
  get_container_diagnostics: "Infrastructure",
  get_container_logs: "Infrastructure",

  // Web Analytics
  get_web_analytics: "Analytics",
};

// ────────────────────────────────────────────────────────────
// Post-init patch — resolve all dynamic placeholders in the
// search_tools schema from TOOL_DEFINITIONS and TOOL_DOMAINS.
// Runs synchronously at module load, before any consumer reads.
// ────────────────────────────────────────────────────────────

const searchToolsDefinition = TOOL_DEFINITIONS.find(
  (tool) => tool.name === "search_tools",
);

if (searchToolsDefinition) {
  const toolCount = String(TOOL_DEFINITIONS.length);

  const domainToToolNames = new Map<string, string[]>();
  for (const [toolName, domain] of Object.entries(TOOL_DOMAINS)) {
    if (!domainToToolNames.has(domain)) {
      domainToToolNames.set(domain, []);
    }
    domainToToolNames.get(domain)!.push(toolName);
  }

  const uniqueDomains = [...new Set(Object.values(TOOL_DOMAINS))].sort();

  const domainCapabilities = uniqueDomains
    .map((domain) => {
      const toolNames = domainToToolNames.get(domain) || [];
      const humanizedToolNames = toolNames.join(", ");
      return `${domain.toLowerCase()} (${humanizedToolNames})`;
    })
    .join(", ");

  const queryExamples = uniqueDomains
    .flatMap((domain) => {
      const toolNames = domainToToolNames.get(domain) || [];
      return toolNames
        .slice(0, 2)
        .map((name) => `'${name}' `);
    })
    .slice(0, 30)
    .map((example) => example.trim())
    .join(", ");

  const knownDomains = uniqueDomains
    .map((domain) => `'${domain}'`)
    .join(", ");

  searchToolsDefinition.description = searchToolsDefinition.description
    .replace("{{TOOL_COUNT}}", toolCount)
    .replace("{{DOMAIN_CAPABILITIES}}", domainCapabilities);

  const queryProperty = searchToolsDefinition.parameters?.properties?.query;
  if (queryProperty?.description) {
    queryProperty.description = queryProperty.description.replace(
      "{{QUERY_EXAMPLES}}",
      queryExamples,
    );
  }

  const domainProperty = searchToolsDefinition.parameters?.properties?.domain;
  if (domainProperty?.description) {
    domainProperty.description = domainProperty.description.replace(
      "{{KNOWN_DOMAINS}}",
      knownDomains,
    );
  }
}

// ────────────────────────────────────────────────────────────
// Tool Emojis — per-tool emoji displayed in the client UI
// ────────────────────────────────────────────────────────────

const TOOL_EMOJIS: Record<string, string | [string, string]> = {
  get_weather: "🌤️",
  get_local_environment: ["🌍", "💻"],
  get_weather_forecast: ["🌤️", "📅"],
  get_canada_avalanche_forecast: ["🏔️", "💻"],
  get_earthquakes: ["🌋", "💻"],
  get_solar_activity: "☀️",
  get_aurora_forecast: ["🌌", "💻"],
  get_solar_wind: "💨",
  get_twilight: "🌅",
  get_tides: ["🌊", "💻"],
  get_wildfires: ["🌲", "🔥"],
  get_iss_location: ["🛸", "💻"],
  get_near_earth_objects: ["☄️", "💻"],
  get_space_launches: ["🚀", "🌌"],
  get_nasa_apod: "🔭",
  get_canada_weather_warnings: ["🌤️", "⚠️"],
  get_detailed_air_quality: ["🫁", "💻"],
  get_pollen_forecast: ["🌸", "💻"],
  get_weather_history: ["🌤️", "📊"],
  get_weather_marine: ["⚓", "💻"],
  get_weather_astronomy: "🌙",
  get_weather_alerts: ["🚨", "💻"],
  get_moon_phase: ["🌙", "🌓"],
  get_events: ["🎟️", "💻"],
  get_live_scores: ["⚽", "💻"],
  get_upcoming_matches: ["⚽", "📅"],
  get_recent_results: ["🏆", "💻"],
  get_league_standings: ["🏆", "📋"],
  get_match_details: ["⚽", "📺"],
  get_head_to_head: "⚔️",
  search_teams: ["🏟️", "💻"],
  search_players: "🧑‍🤝‍🧑",
  get_team_squad: "👥",
  get_league_top_scorers: ["⭐", "💻"],
  get_commodities: ["📦", "📈"],
  get_trends: ["📈", "🔍"],
  search_products: ["🔍", "🛒"],
  get_trending_products: ["🔥", "🛒"],
  get_watchlist_availability: ["👁️", "📋"],
  check_sku_availability: ["✅", "💻"],
  get_costco_us_products: ["🏪", "🇺🇸"],
  get_costco_ca_products: ["🏪", "🇨🇦"],
  search_amazon_products: ["📦", "🛒"],
  get_stock: "💹",
  get_macro: ["🏛️", "💻"],
  get_market_news: ["💹", "📰"],
  get_earnings_calendar: "💰",
  get_historical_prices: "🕯️",
  get_technical_analysis: "📊",
  get_volatility: "🌊",
  get_fear_greed_index: "😰",
  get_sec_filings: "🏛️",
  get_sector_performance: ["📊", "🗺️"],
  search_books: ["📚", "💻"],
  search_library_docs: ["📖", "💻"],
  get_country: ["🌐", "🗺️"],
  get_element: "⚛️",
  get_exoplanet: ["🪐", "💻"],
  get_anime: "🎌",
  get_word_definition: ["📖", "🔤"],
  search_papers: ["🎓", "💻"],
  get_wikipedia_summary: "📘",
  get_on_this_day: ["🕰️", "📜"],
  list_development_indicators: ["📈", "🌐"],
  search_youtube: ["▶️", "🔍"],
  get_youtube_video: "▶️",
  download_video: ["🎬", "📥"],
  trim_video: ["✂️", "🎬"],
  read_url: "🌐",
  get_package_info: ["📦", "ℹ️"],
  read_rss_feed: "📡",
  get_pypi_package: ["🐍", "📦"],
  get_music: "🎵",
  get_wayback_snapshot: ["🕰️", "💻"],
  search_craigslist: ["📋", "🔍"],
  search_kijiji: ["🍁", "🔍"],
  search_autotrader: ["🚗", "🔍"],
  search_ebay: ["🛒", "🔍"],
  search_etsy: ["🧶", "🔍"],
  search_spotify: ["🎧", "🔍"],
  get_spotify: ["🎧", "📄"],
  control_spotify: ["🎧", "▶️"],
  search_reddit: ["🤖", "💬"],
  search_reddit_subreddits: ["🤖", "🔍"],
  get_reddit_subreddit_info: "ℹ️",
  get_reddit_subreddit_feed: ["🤖", "📰"],
  get_reddit_subreddit_rules: ["🤖", "⚖️"],
  get_reddit_subreddit_wiki_pages: ["🤖", "📄"],
  get_reddit_subreddit_wiki_page: ["🤖", "📖"],
  get_reddit_user_history: ["🤖", "📜"],
  get_reddit_user_profile: "👤",

  search_media: ["🎬", "🔍"],
  get_media_details: "🎥",
  get_media_credits: ["🌟", "💻"],
  get_trending_media: ["🔥", "🎬"],
  browse_media: ["🍿", "💻"],
  get_media_genres: ["🎭", "🍿"],
  get_now_playing_media: ["🎬", "🍿"],
  get_media_recommendations: ["🍿", "💡"],
  search_person: ["🧑‍🎤", "💻"],
  get_watch_providers: ["📺", "ℹ️"],
  search_drugs: "💊",
  get_drug_adverse_events: "⚕️",
  get_drug_recalls: "🚫",
  search_food_nutrition: ["🍎", "💻"],
  rank_foods_by_nutrient: ["🥦", "📊"],
  compare_food_nutrition: ["⚖️", "🍎"],
  get_nutrition_reference: ["🥗", "🗂️"],
  get_nutritional_requirements: ["📏", "💻"],
  list_drug_dosage_forms: "💉",
  search_gym_exercises: "🏋️",
  get_gym_exercise_categories: ["🏋️", "🗂️"],
  get_gym_exercise_by_id: ["🎯", "💻"],
  calculate_caloric_needs: "🔢",
  analyze_nutrient_gaps: ["📉", "💻"],
  search_food_substitutes: ["🔄", "🍎"],
  estimate_exercise_calories: "🏃",
  calculate_hydration_needs: ["💧", "💻"],
  build_meal_plan: ["🍽️", "💻"],
  check_drug_nutrient_interactions: ["💊", "⚠️"],
  get_translink_next_bus: ["🚌", "💻"],
  get_translink_stop_info: "🚏",
  search_translink_stops_nearby: ["🚌", "📍"],
  get_translink_route_info: ["🚌", "🗺️"],
  search_airports: ["✈️", "💻"],
  evaluate_expression: "🧮",
  convert_currency: "💱",
  get_time_in_timezone: "🕐",
  get_ip_info: ["🔎", "🌐"],
  search_nearby_places: ["🔍", "📍"],
  search_places: ["🔍", "🗺️"],
  generate_map: ["🎨", "🗺️"],
  generate_chart: ["📊", "📉"],
  get_public_webcams: ["📷", "💻"],
  execute_python: ["🐍", "💻"],
  execute_javascript: ["⚡", "💻"],
  execute_shell: "🖥️",
  convert_units: "📐",
  parse_datetime: ["📅", "⏰"],
  transform_json: ["🔧", "💻"],
  generate_csv: ["📋", "🔢"],
  generate_qr_code: ["💻", "📱"],
  scan_barcode: ["📷", "🔍"],
  render_code: ["🖼️", "💻"],
  generate_avatar: ["🧑‍🎨", "🎲"],
  generate_ascii_banner: ["🔤", "🎨"],
  render_latex: ["📐", "✍️"],
  generate_diagram: ["📊", "🧩"],
  diff_text: "🔀",
  generate_hash: "🔐",
  test_regex: "🔣",
  convert_encoding: "🔁",
  convert_color: ["🎨", "🌈"],
  manipulate_image: ["🖼️", "🎨"],
  detect_objects: ["🔍", "🖼️"],
  remove_background: ["✂️", "🖼️"],
  convert_image_to_ascii: ["🎨", "💻"],
  convert_video_to_gif: ["🎬", "🔁"],
  parse_cron_expression: ["⏰", "🔣"],
  draw_turtle_graphics: ["🐢", "💻"],
  create_3d_mesh: "🔺",
  create_3d_scene: ["🌐", "🧱"],
  create_3d_voxel: ["🧱", "🧊"],
  think: ["🧠", "💭"],
  sleep: "💤",
  emit_structured_output: "📝",
  get_dota: ["🎮", "💻"],
  get_steam_profile: ["🎮", "🔍"],
  create_bonfire: ["🔥", "🏕️"],
  search_torrents: ["🧲", "🔍"],
  download_torrent: "⬇️",
  get_torrent_status: ["⬇️", "📊"],
  get_tracked_vessels: "🚢",
  get_vessel_by_mmsi: ["🚢", "🆔"],
  search_vessels: "⛵",
  get_vessels_in_area: ["🚢", "🗺️"],
  get_ais_messages: ["📡", "💬"],
  get_energy_indicators: ["⚡", "🔋"],
  get_energy_catalog: ["⚡", "📊"],
  get_energy_facets: ["🔋", "💻"],
  search_energy: ["⚡", "🔍"],
  get_electricity_retail_sales: ["🔌", "⚡"],
  get_petroleum_prices: "🛢️",
  get_natural_gas_prices: ["🔥", "💰"],
  read_file: "📄",
  write_file: ["✏️", "💻"],
  replace_in_file: ["🔧", "📄"],
  apply_patch: ["🩹", "📄"],
  code_intel: ["🧠", "💻"],
  read_files: "📑",
  get_file_info: ["📄", "ℹ️"],
  move_file: "📂",
  delete_file: ["💻", "🗑️"],
  edit_notebook: "📓",
  debug: ["🐛", "💻"],
  commit_split: ["📦", "✂️"],
  list_directory: "📁",
  search_file_contents: ["📄", "🔍"],
  find_files: ["💻", "🔎"],
  summarize_project: "📋",
  read_web_page: ["🌐", "📄"],
  read_pdf: ["📄", "📕"],
  read_image_text: ["📷", "📝"],
  read_docx: ["📝", "📄"],
  read_spreadsheet: ["📄", "📊"],
  read_csv: ["🧾", "📊"],
  search_web: ["🌐", "🔍"],
  search_news: ["📰", "🔍"],
  search_images: ["🖼️", "🔍"],
  search_videos: ["🎬", "🔍"],
  execute_command: ["▶️", "🖥️"],
  get_background_output: ["📟", "👀"],
  list_background_processes: ["📟", "📋"],
  kill_process: ["📟", "🛑"],
  run_git: ["📦", "🔀"],
  control_browser: ["🌐", "🖱️"],
  execute_browser_script: ["🌐", "📜"],
  create_task: "➕",
  get_task: ["📋", "📌"],
  list_tasks: ["📝", "📋"],
  update_task: ["✏️", "📋"],
  save_memory: ["💻", "🧠"],
  write_datastore: ["🗄️", "✏️"],
  query_datastore: ["🗄️", "🔍"],
  delete_datastore: ["🗄️", "🗑️"],
  create_custom_agent: ["💻", "🤖"],
  list_custom_agents: ["🤖", "📋"],
  list_agents: ["🤖", "📋"],
  update_custom_agent: ["✏️", "🤖"],
  search_tools: ["🛠️", "🔍"],
  create_cron: ["⏰", "💻"],
  remote_trigger: ["📡", "🚀"],
  create_cron_job: "🗓️",
  list_cron_jobs: ["⏰", "📋"],
  delete_cron_job: ["⏰", "🗑️"],
  trigger_cron_job: ["💻", "🚀"],
  send_email: ["📧", "📤"],
  search_email: ["📧", "🔍"],
  read_email: ["📧", "📖"],
  send_sms: ["💬", "💻"],
  list_sms_messages: "📨",
  get_sms_account: ["📱", "💬"],
  lookup_phone_number: "📞",
  list_phone_numbers: "📲",
  get_emoji_combination: ["🍳", "💻"],
  get_emoji_combinations: "🧑‍🍳",
  generate_image: ["💻", "🖼️"],
  describe_image: ["👁️", "💻"],
  synthesize_speech: "🔊",
  synthesize_speech_local: ["🗣️", "💻"],
  generate_audio: ["🔊", "🎵"],
  remix_audio: ["🎛️", "🔊"],
  create_vector_animation: ["🎬", "🎨"],
  transcribe_audio: ["🎤", "💻"],
  search_discord_messages: ["💬", "🔍"],
  get_discord_message_analytics: ["💬", "📊"],
  get_discord_server_activity: ["💬", "📈"],
  get_discord_guild_channels: ["📁", "💬"],
  get_discord_guild_members: ["👥", "💬"],
  get_discord_guild_emojis: ["💻", "😀"],
  get_bot_stats: ["🤖", "📊"],
  get_bot_guilds: ["🌐", "🤖"],
  get_bot_activity_timeline: ["🤖", "📈"],
  get_discord_user_heatmap_data: ["🔥", "📊"],
  get_discord_mention_leaderboard: ["💬", "🏆"],
  get_discord_message_leaderboard: ["🏆", "📊"],
  get_discord_word_frequencies: ["🗣️", "📊"],
  react_to_discord_message: ["🎭", "💬"],
  get_discord_voice_channel_members: ["🔊", "👥"],
  get_discord_user_profile: ["👤", "💬"],
  get_discord_channel_activity_stats: ["📁", "📊"],
  get_discord_gold_balance: ["🪙", "💬"],
  give_discord_gold: ["🪙", "🎁"],
  mug_discord_gold: ["🪙", "🐺"],
  list_lights: ["💡", "📋"],
  set_light_state: "🎚️",
  toggle_light_power: ["🔌", "💡"],
  start_light_breathe_effect: ["🌬️", "💻"],
  start_light_pulse_effect: ["💥", "💻"],
  start_light_move_effect: ["🔄", "💡"],
  start_light_flame_effect: ["🔥", "💡"],
  start_light_morph_effect: ["🌈", "💻"],
  set_light_states: ["💡", "⚙️"],
  paint_lights_from_image: ["💡", "🎨"],
  adjust_light_state: ["💡", "📊"],
  stop_light_effects: "⏹️",
  list_light_scenes: ["🎬", "💡"],
  activate_light_scene: ["▶️", "💡"],
  enable_light_night_lock: ["🔒", "💡"],
  get_light_health: ["❤️", "💻"],

  // Network Intelligence
  dns_lookup: ["🌐", "🔎"],
  whois_lookup: ["🌐", "📋"],
  ssl_certificate_check: ["🔒", "🌐"],
  port_scan: ["🔌", "🔍"],
  http_headers: ["📡", "🔎"],
  ping_host: ["📶", "🌐"],

  // Security
  check_breach: ["🔓", "🔍"],

  // Communication (new tools)
  send_push_notification: ["🔔", "📱"],
  send_webhook: ["🪝", "🌐"],

  // Calendar
  get_calendar_events: ["📅", "🔎"],
  create_calendar_event: ["📅", "➕"],
  get_free_busy: ["📅", "⏰"],

  // Trends (new tool)
  get_github_trending: ["🔥", "💻"],

  // Compute (new tools)
  analyze_csv: ["📊", "🔢"],
  compare_json: ["🔀", "📋"],
  validate_json_schema: ["✅", "📋"],

  // Knowledge (new tools)
  get_stackoverflow_questions: ["💬", "📚"],
  search_patents: ["📜", "🔍"],

  // Weather & Environment (new tool)
  get_satellite_imagery: ["🛰️", "🌍"],

  // Transit (new tool)
  get_flight_status: ["✈️", "📍"],

  // Infrastructure Observability
  get_infrastructure_status: ["🌀", "📊"],
  get_container_diagnostics: ["🐳", "📈"],
  get_container_logs: ["📋", "🔍"],

  // Web Analytics
  get_web_analytics: ["📈", "🌐"],
};

// ────────────────────────────────────────────────────────────
// API Key Gating — maps tools to required CONFIG keys
// ────────────────────────────────────────────────────────────
// Tools listed here will be excluded from schema responses
// when their required API keys are missing (falsy) in CONFIG.
// Tools NOT listed here are always available (public APIs,
// in-memory datasets, compute tools, scrapers, etc.).
// ────────────────────────────────────────────────────────────

import CONFIG, { type ToolsServiceConfig } from "../config.ts";
import logger from "../logger.ts";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const TOOL_REQUIRED_KEYS = {
  // Movies & TV (all require TMDb API key — unified media tools)
  search_media: ["TMDB_API_KEY"],
  get_media_details: ["TMDB_API_KEY"],
  get_media_credits: ["TMDB_API_KEY"],
  get_trending_media: ["TMDB_API_KEY"],
  browse_media: ["TMDB_API_KEY"],
  get_media_genres: ["TMDB_API_KEY"],
  get_now_playing_media: ["TMDB_API_KEY"],
  get_media_recommendations: ["TMDB_API_KEY"],
  search_person: ["TMDB_API_KEY"],
  get_watch_providers: ["TMDB_API_KEY"],

  // Finance — Finnhub
  get_stock: ["FINNHUB_API_KEY"],
  get_market_news: ["FINNHUB_API_KEY"],
  get_earnings_calendar: ["FINNHUB_API_KEY"],

  // Finance — FRED
  get_macro: ["FRED_API_KEY"],

  // Transit (all require TransLink API key)
  get_translink_next_bus: ["TRANSLINK_API_KEY"],
  get_translink_stop_info: ["TRANSLINK_API_KEY"],
  search_translink_stops_nearby: ["TRANSLINK_API_KEY"],
  get_translink_route_info: ["TRANSLINK_API_KEY"],

  // Places (require Google Places API key)
  search_nearby_places: ["GOOGLE_CLOUD_API_KEY"],
  search_places: ["GOOGLE_CLOUD_API_KEY"],
  generate_map: ["GOOGLE_CLOUD_API_KEY"],

  // YouTube (requires Google API key with YouTube Data API v3 enabled)
  search_youtube: ["GOOGLE_CLOUD_API_KEY"],

  // Weather (only specific Google-powered tools)
  get_detailed_air_quality: ["GOOGLE_CLOUD_API_KEY"],
  get_pollen_forecast: ["GOOGLE_CLOUD_API_KEY"],

  // Maritime (all require AIS Stream API key)
  get_tracked_vessels: ["AIS_STREAM_API_KEY"],
  get_vessel_by_mmsi: ["AIS_STREAM_API_KEY"],
  search_vessels: ["AIS_STREAM_API_KEY"],
  get_vessels_in_area: ["AIS_STREAM_API_KEY"],
  get_ais_messages: ["AIS_STREAM_API_KEY"],

  // Energy (all require EIA API key)
  get_energy_indicators: ["EIA_API_KEY"],
  get_energy_catalog: ["EIA_API_KEY"],
  get_energy_facets: ["EIA_API_KEY"],
  search_energy: ["EIA_API_KEY"],
  get_electricity_retail_sales: ["EIA_API_KEY"],
  get_petroleum_prices: ["EIA_API_KEY"],
  get_natural_gas_prices: ["EIA_API_KEY"],

  // Communication (Twilio — all require account SID + auth token)
  send_email: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
  search_email: ["IMAP_HOST", "IMAP_USER", "IMAP_PASS"],
  read_email: ["IMAP_HOST", "IMAP_USER", "IMAP_PASS"],
  send_sms: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  list_sms_messages: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  get_sms_account: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  lookup_phone_number: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  list_phone_numbers: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],

  // Creative (require Prism as LLM backend)
  generate_image: ["PRISM_SERVICE_URL"],
  describe_image: ["PRISM_SERVICE_URL"],
  synthesize_speech: ["PRISM_SERVICE_URL"],
  synthesize_speech_local: [],
  transcribe_audio: ["PRISM_SERVICE_URL"],

  // Agent Management (require Prism for CustomAgentService)
  create_custom_agent: ["PRISM_SERVICE_URL"],
  list_custom_agents: ["PRISM_SERVICE_URL"],
  list_agents: ["PRISM_SERVICE_URL"],
  update_custom_agent: ["PRISM_SERVICE_URL"],


  // Torrent (all require qBittorrent connection)
  search_torrents: ["QBITTORRENT_URL"],
  download_torrent: ["QBITTORRENT_URL"],
  get_torrent_status: ["QBITTORRENT_URL"],

  // Marketplaces
  search_ebay: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
  search_etsy: ["ETSY_API_KEY", "ETSY_SHARED_SECRET"],

  // Music (Spotify)
  search_spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  get_spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  control_spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],

  // Reddit
  search_reddit: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  search_reddit_subreddits: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  get_reddit_subreddit_info: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  get_reddit_subreddit_feed: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  get_reddit_subreddit_rules: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  get_reddit_subreddit_wiki_pages: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  get_reddit_subreddit_wiki_page: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  get_reddit_user_history: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  get_reddit_user_profile: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],

  // Calendar (Google Calendar API)
  get_calendar_events: ["GOOGLE_CALENDAR_CREDENTIALS"],
  create_calendar_event: ["GOOGLE_CALENDAR_CREDENTIALS"],
  get_free_busy: ["GOOGLE_CALENDAR_CREDENTIALS"],

  // Satellite Imagery (NASA)
  get_satellite_imagery: ["NASA_API_KEY"],

  // Flight Status (AviationStack)
  get_flight_status: ["AVIATIONSTACK_API_KEY"],

  // Infrastructure Observability (requires Portal Service)
  get_infrastructure_status: ["PORTAL_SERVICE_URL"],
  get_container_diagnostics: ["PORTAL_SERVICE_URL"],
  get_container_logs: ["PORTAL_SERVICE_URL"],

  // Web Analytics (GA + sessions-service, both proxied by Portal)
  get_web_analytics: ["PORTAL_SERVICE_URL"],
};

// ────────────────────────────────────────────────────────────
// Static Data File Gating — disables tools whose backing
// CSV/data files are missing at runtime (e.g. when the Docker
// image ships without the src/**/data directories).
// Paths are relative to the project src/ root.
// ────────────────────────────────────────────────────────────

const TOOL_REQUIRED_DATA_FILES: Record<string, string[]> = {
  get_element: ["fetchers/knowledge/data/digest_elements.csv"],
  get_exoplanet: ["fetchers/knowledge/data/digest_exoplanets.csv"],
  get_country: ["fetchers/knowledge/data/digest_world_indicators.csv"],
  list_development_indicators: [
    "fetchers/knowledge/data/digest_world_indicators.csv",
  ],
  rank_foods_by_nutrient: ["fetchers/health/data/digest_food.csv"],
  search_food_nutrition: ["fetchers/health/data/digest_food.csv"],
  get_nutritional_requirements: [
    "fetchers/health/data/digest_nutrient_requirement.csv",
  ],
  analyze_nutrient_gaps: [
    "fetchers/health/data/digest_food.csv",
    "fetchers/health/data/digest_nutrient_requirement.csv",
  ],
  search_food_substitutes: ["fetchers/health/data/digest_food.csv"],
  build_meal_plan: ["fetchers/health/data/digest_food.csv"],
};

const serviceRootDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

function validateRequiredDataFiles(): void {
  for (const [toolName, requiredFiles] of Object.entries(
    TOOL_REQUIRED_DATA_FILES,
  )) {
    for (const relativeFilePath of requiredFiles) {
      const absoluteFilePath = resolve(serviceRootDirectory, relativeFilePath);
      if (!existsSync(absoluteFilePath)) {
        disableToolRuntime(
          toolName,
          `Missing required data file: ${relativeFilePath}`,
        );
        break;
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Runtime Tool Health Registry
// ────────────────────────────────────────────────────────────
// Collectors call disableToolRuntime() when they detect
// persistent failures (403 blocked API, 410 Gone, bot detection)
// that make a tool permanently unusable for this session.
// This supplements the static TOOL_REQUIRED_KEYS check.
// ────────────────────────────────────────────────────────────

const TOOL_DISABLED_RUNTIME = new Map<string, string>();

/**
 * Mark a tool as disabled at runtime due to a persistent failure.
 * The reason is logged and included in getDisabledTools() diagnostics.
 */
export function disableToolRuntime(toolName: string, reason: string): void {
  if (!TOOL_DISABLED_RUNTIME.has(toolName)) {
    TOOL_DISABLED_RUNTIME.set(toolName, reason);
    logger.warn(
      `[ToolSchema] 🚫 Disabled tool "${toolName}" at runtime: ${reason}`,
    );
  }
}

/**
 * Re-enable a previously runtime-disabled tool (e.g., after a successful fetch).
 */
export function enableToolRuntime(toolName: string): void {
  if (TOOL_DISABLED_RUNTIME.delete(toolName)) {
    logger.info(`[ToolSchema] ✅ Re-enabled tool "${toolName}" at runtime`);
  }
}

validateRequiredDataFiles();

// ────────────────────────────────────────────────────────────
// Registry Integrity Validation — catches metadata maps that
// drifted from the real tool catalog (e.g. a tool was renamed
// but its TOOL_REQUIRED_KEYS entry kept the old name, silently
// disabling the gate). Runs once at boot; warn-only so a drift
// never blocks startup. The Vitest suite asserts zero drift.
// ────────────────────────────────────────────────────────────

export interface RegistryDriftReport {
  /** Map name → keys that don't match any tool definition */
  staleKeys: Record<string, string[]>;
  /** Tool names with no TOOL_DOMAINS entry */
  missingDomains: string[];
  /** Tool names with no TOOL_EMOJIS entry */
  missingEmojis: string[];
}

export function validateToolRegistries(): RegistryDriftReport {
  const definedNames = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

  const registries: Record<string, Record<string, unknown>> = {
    TOOL_DOMAINS,
    TOOL_EMOJIS,
    TOOL_REQUIRED_KEYS,
    TOOL_REQUIRED_DATA_FILES,
  };

  const staleKeys: Record<string, string[]> = {};
  for (const [registryName, registry] of Object.entries(registries)) {
    const stale = Object.keys(registry).filter(
      (toolName) => !definedNames.has(toolName),
    );
    if (stale.length > 0) staleKeys[registryName] = stale;
  }

  const missingDomains = [...definedNames].filter(
    (name) => !(name in TOOL_DOMAINS),
  );
  const missingEmojis = [...definedNames].filter(
    (name) => !(name in TOOL_EMOJIS),
  );

  for (const [registryName, stale] of Object.entries(staleKeys)) {
    logger.warn(
      `[ToolSchema] ⚠️ ${registryName} has ${stale.length} entr${stale.length === 1 ? "y" : "ies"} that match no tool definition (renamed/removed tool?): ${stale.join(", ")}`,
    );
  }
  if (missingDomains.length > 0) {
    logger.warn(
      `[ToolSchema] ⚠️ ${missingDomains.length} tools have no TOOL_DOMAINS entry: ${missingDomains.join(", ")}`,
    );
  }

  return { staleKeys, missingDomains, missingEmojis };
}

validateToolRegistries();

/**
 * Check if a tool is available.
 * Returns false if required API keys are missing OR the tool
 * has been disabled at runtime by a collector.
 */
function isToolAvailable(toolName: string) {
  if (TOOL_DISABLED_RUNTIME.has(toolName)) return false;
  const keys = TOOL_REQUIRED_KEYS[toolName as keyof typeof TOOL_REQUIRED_KEYS];
  if (!keys) return true;
  return keys.every((key: string) =>
    Boolean(CONFIG[key as keyof ToolsServiceConfig]),
  );
}


// ────────────────────────────────────────────────────────────
// Intelligence Tier — Dynamic Complexity Scoring Algorithm
// ────────────────────────────────────────────────────────────
// Computes each tool's intelligence tier from its JSON Schema
// definition via recursive schema introspection. Scores both
// structural complexity (nesting, enums, arrays) and semantic
// parameter types (code generation, expression syntax, etc.)
// detected from parameter descriptions.
// ────────────────────────────────────────────────────────────

// ── Structural Scoring Weights ──────────────────────────────

const COMPLEXITY_WEIGHTS = {
  PARAMETER_COUNT: 1,
  REQUIRED_PARAMETER: 1.5,
  NESTED_OBJECT: 3,
  ENUM_PARAMETER: 2,
  ENUM_OPTION: 0.2,
  ARRAY_PARAMETER: 3,
  ANY_OF_UNION: 4,
  NESTED_ARRAY_OBJECT: 4,
} as const;

// ── Semantic Parameter Type Detection ───────────────────────
// Detects what KIND of content a parameter expects the model
// to generate, scored by generation difficulty.

const SEMANTIC_PARAMETER_TYPES = [
  {
    label: "code-generation",
    weight: 9,
    pattern: /\bsource\s+code\b|\bcode\s+to\s+(?:execute|run)\b|\bscript\s+(?:to|body)\b/i,
  },
  {
    label: "shell-command",
    weight: 8,
    pattern: /\bshell\s+command|\bcommand\s+to\s+(?:execute|run)\b/i,
  },
  {
    label: "expression-syntax",
    weight: 6,
    pattern: /\bcron\s+expression\b|\bregex\b|\bregular\s+expression\b|\bjsonpath\s+expression\b|\bmermaid\b.*\bsyntax\b|\bturtle\s+command/i,
  },
  {
    label: "structured-schema",
    weight: 5,
    pattern: /\bjson\s+schema\s+definition\b/i,
  },
  {
    label: "precise-text-match",
    weight: 4,
    pattern: /\bexact\s+(?:text|string|content)\b|\btext\s+to\s+(?:find|replace|match)\b|\breplacement\s+chunk/i,
  },
] as const;

function scoreSemanticComplexity(description?: string): number {
  if (!description) return 0;

  for (const semanticType of SEMANTIC_PARAMETER_TYPES) {
    if (semanticType.pattern.test(description)) {
      return semanticType.weight;
    }
  }

  return 0;
}

const TIER_THRESHOLDS = {
  FRONTIER: 25,
  HIGH: 12,
  MEDIUM: 5,
} as const;

// ── Schema Introspection ────────────────────────────────────

function scorePropertyComplexity(
  property: ToolParameterProperty,
  currentDepth: number,
): number {
  let score = 0;

  score += scoreSemanticComplexity(property.description);

  if (property.enum) {
    score += COMPLEXITY_WEIGHTS.ENUM_PARAMETER;
    score += property.enum.length * COMPLEXITY_WEIGHTS.ENUM_OPTION;
  }

  if (property.anyOf) {
    score += COMPLEXITY_WEIGHTS.ANY_OF_UNION;
    for (const variant of property.anyOf) {
      score += scorePropertyComplexity(variant, currentDepth + 1);
    }
  }

  if (property.type === "array") {
    score += COMPLEXITY_WEIGHTS.ARRAY_PARAMETER;

    if (property.items) {
      const itemSchema = property.items as ToolParameterProperty;
      if (itemSchema.type === "object" && itemSchema.properties) {
        score += COMPLEXITY_WEIGHTS.NESTED_ARRAY_OBJECT;
        score += scoreObjectProperties(
          itemSchema.properties,
          itemSchema.required,
          currentDepth + 1,
        );
      } else {
        score += scorePropertyComplexity(itemSchema, currentDepth + 1);
      }
    }
  }

  if (property.type === "object" && property.properties) {
    score += COMPLEXITY_WEIGHTS.NESTED_OBJECT;
    score += scoreObjectProperties(
      property.properties,
      property.required,
      currentDepth + 1,
    );
  }

  return score;
}

function scoreObjectProperties(
  properties: Record<string, ToolParameterProperty>,
  requiredFields?: string[],
  currentDepth: number = 0,
): number {
  let score = 0;
  const propertyNames = Object.keys(properties);

  score += propertyNames.length * COMPLEXITY_WEIGHTS.PARAMETER_COUNT;

  if (requiredFields) {
    score += requiredFields.length * COMPLEXITY_WEIGHTS.REQUIRED_PARAMETER;
  }

  for (const propertyName of propertyNames) {
    score += scorePropertyComplexity(properties[propertyName], currentDepth);
  }

  return score;
}

export function calculateToolComplexityScore(
  parameters?: ToolParameters,
): number {
  if (!parameters?.properties) return 0;

  return scoreObjectProperties(
    parameters.properties,
    parameters.required,
    0,
  );
}

function tierFromScore(score: number): ToolIntelligenceTier {
  if (score >= TIER_THRESHOLDS.FRONTIER) return "frontier";
  if (score >= TIER_THRESHOLDS.HIGH) return "high";
  if (score >= TIER_THRESHOLDS.MEDIUM) return "medium";
  return "low";
}

// ── Tier Resolution ─────────────────────────────────────────

function resolveToolIntelligenceTier(
  _toolName: string,
  parameters?: ToolParameters,
): { intelligenceTier: ToolIntelligenceTier; complexityScore: number } {
  const complexityScore = calculateToolComplexityScore(parameters);

  return {
    complexityScore,
    intelligenceTier: tierFromScore(complexityScore),
  };
}

// Tier resolution walks the whole parameter schema recursively; memoize per
// definition object (definition arrays are cached per locale, so identity is
// stable) instead of re-scoring all ~270 tools on every schema request.
const tierCache = new WeakMap<
  ToolDefinition,
  { intelligenceTier: ToolIntelligenceTier; complexityScore: number }
>();

function resolveToolIntelligenceTierCached(tool: ToolDefinition) {
  let tier = tierCache.get(tool);
  if (!tier) {
    tier = resolveToolIntelligenceTier(tool.name, tool.parameters);
    tierCache.set(tool, tier);
  }
  return tier;
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

// Re-export taxonomy registries for testing and downstream consumers
export {
  TOOL_DOMAINS,
  TOOL_EMOJIS,
  TOOL_DEFINITIONS,
  COMPLEXITY_WEIGHTS,
  SEMANTIC_PARAMETER_TYPES,
  TIER_THRESHOLDS,
};

export function getToolDefinitionCount(): number {
  return TOOL_DEFINITIONS.length;
}

/**
 * Get all tool schemas with endpoint metadata.
 * Used by clients (like Prism Client) to build dynamic executors.
 * Filters out tools whose required API keys are not configured.
 */
/**
 * Resolves a tool's emoji. If it's mapped to a pair (like ["🌤️", "🌡️"]), it checks
 * the Google Emoji Kitchen cache for a combined static URL. Falls back to the first
 * emoji character in the pair if the cache is empty or the mashup isn't found.
 */
export function resolveToolEmoji(toolName: string): string | null {
  const emojiValue = TOOL_EMOJIS[toolName as keyof typeof TOOL_EMOJIS];
  if (!emojiValue) return null;

  if (Array.isArray(emojiValue)) {
    try {
      const combination = queryEmojiCombination(emojiValue[0], emojiValue[1]);
      if (combination && combination.gStaticUrl) {
        return combination.gStaticUrl;
      }
    } catch {
      // Graceful fallback on error
    }
    return emojiValue[0];
  }

  return emojiValue;
}


export function getToolSchemas(locale?: string): ToolSchema[] {
  const definitions = locale
    ? getLocalizedToolDefinitions(locale)
    : TOOL_DEFINITIONS;

  return definitions.filter((tool) => isToolAvailable(tool.name)).map(
    (tool) => {
      const domain =
        TOOL_DOMAINS[tool.name as keyof typeof TOOL_DOMAINS] || "Other";
      const { intelligenceTier, complexityScore } =
        resolveToolIntelligenceTierCached(tool);
      return {
        ...tool,
        domain,
        domainKey: resolveDomainKey(domain),
        emoji: resolveToolEmoji(tool.name),
        intelligenceTier,
        complexityScore,
      };
    },
  );
}

/**
 * Get tool schemas cleaned for LLM consumption.
 * Strips the `endpoint` property since the AI doesn't need routing info.
 * Filters out tools whose required API keys are not configured.
 */
export function getToolSchemasForAI(locale?: string): ToolSchemaForAI[] {
  const definitions = locale
    ? getLocalizedToolDefinitions(locale)
    : TOOL_DEFINITIONS;

  return definitions.filter((tool) => isToolAvailable(tool.name)).map(
    (tool) => {
      const { endpoint: _endpoint, dataSource: _dataSource, ...rest } = tool;
      const { intelligenceTier, complexityScore } =
        resolveToolIntelligenceTierCached(tool);
      return {
        ...rest,
        intelligenceTier,
        complexityScore,
      };
    },
  );
}

export interface TransformedDisabledTool {
  name: string;
  domain: string;
  missingKeys: string[];
  runtimeDisabled?: string;
}

/**
 * Get tools that are disabled due to missing API keys or runtime failures.
 * Useful for admin diagnostics and health checks.
 */
export function getDisabledTools(): TransformedDisabledTool[] {
  return TOOL_DEFINITIONS.filter((tool) => !isToolAvailable(tool.name)).map(
    (tool) => {
      const requiredKeys =
        TOOL_REQUIRED_KEYS[tool.name as keyof typeof TOOL_REQUIRED_KEYS] || [];
      const runtimeReason = TOOL_DISABLED_RUNTIME.get(tool.name);

      return {
        name: tool.name,
        domain: TOOL_DOMAINS[tool.name as keyof typeof TOOL_DOMAINS] || "Other",
        missingKeys: requiredKeys.filter(
          (key: string) => !CONFIG[key as keyof ToolsServiceConfig],
        ),
        ...(runtimeReason && { runtimeDisabled: runtimeReason }),
      };
    },
  );
}

/**
 * Get the available fields map.
 */
export function getFields() {
  return FIELDS;
}
