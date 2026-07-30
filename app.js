const STORAGE_KEY = "weekly-food-planner-v1";
const SUPABASE_SETTINGS_KEY = "weekly-food-planner-supabase";
const LEGACY_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WINDOW_DAYS = 7;
const PLAN_META_KEY = "__meta";
const MEAL_KEYS = ["breakfast", "lunch", "tea"];
const SNACKS_KEY = "snacks";
let supabaseClient = null;
let supabaseClientConfig = null;
let syncState = { message: "Not connected yet.", ok: false };

function sanitizeSupabaseUrl(rawValue) {
  if (!rawValue) return "";

  let value = rawValue.trim();
  const lower = value.toLowerCase();
  const httpsStart = lower.indexOf("https://");
  const httpStart = lower.indexOf("http://");
  const startCandidates = [httpsStart, httpStart].filter((index) => index >= 0);

  if (startCandidates.length && Math.min(...startCandidates) > 0) {
    value = value.slice(Math.min(...startCandidates));
  }

  const normalizedLower = value.toLowerCase();
  const nextHttps = normalizedLower.indexOf("https://", 8);
  const nextHttp = normalizedLower.indexOf("http://", 7);
  const nextCandidates = [nextHttps, nextHttp].filter((index) => index > 0);
  if (nextCandidates.length) {
    value = value.slice(0, Math.min(...nextCandidates));
  }

  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    return "";
  }
}

function getStartOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getConsecutiveDateKeys(count, startDate = getStartOfToday()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return toDateKey(date);
  });
}

function formatDateLabel(date) {
  return `${date.toLocaleDateString("en-GB", { weekday: "long" })} ${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
}

function getDisplayDayLabel(dayKey) {
  const dayDate = fromDateKey(dayKey);
  return dayDate ? formatDateLabel(dayDate) : dayKey;
}

function getPlanMeta(plan) {
  const meta = plan?.[PLAN_META_KEY];
  if (!meta || typeof meta !== "object") {
    return { extraDays: 0 };
  }

  return {
    extraDays: Number.isInteger(meta.extraDays) && meta.extraDays >= 0 ? meta.extraDays : 0
  };
}

function setPlanMeta(plan, meta) {
  plan[PLAN_META_KEY] = {
    extraDays: Number.isInteger(meta.extraDays) && meta.extraDays >= 0 ? meta.extraDays : 0
  };
}

function getExtraDays(plan) {
  return getPlanMeta(plan).extraDays;
}

function setExtraDays(plan, extraDays) {
  setPlanMeta(plan, { extraDays });
}

function getVisibleDayKeys(plan) {
  const totalDays = WINDOW_DAYS + getExtraDays(plan);
  return getConsecutiveDateKeys(totalDays);
}

function getDataDayKeys(plan) {
  return Object.keys(plan || {}).filter((key) => key !== PLAN_META_KEY && fromDateKey(key));
}

function ensureVisibleDayPlans(plan) {
  getVisibleDayKeys(plan).forEach((dayKey) => {
    if (!plan[dayKey]) {
      plan[dayKey] = createDayPlan();
    }
  });
}

function prunePlanToVisibleDays(plan) {
  const visibleKeys = new Set(getVisibleDayKeys(plan));
  getDataDayKeys(plan).forEach((dayKey) => {
    if (!visibleKeys.has(dayKey)) {
      delete plan[dayKey];
    }
  });
}

function getLegacyWeekStart() {
  const today = getStartOfToday();
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  return monday;
}
const COURSE_KEYS = ["main", "starter", "dessert"];
const OPTIONAL_TEA_COURSES = ["starter", "dessert"];
const OPTIONAL_LUNCH_COURSES = ["starter", "dessert"];

function createCourseEntry(name = "", notes = "", visible = false) {
  return { name, notes, visible };
}

function createMealEntry() {
  return {
    main: createCourseEntry(),
    starter: createCourseEntry("", "", false),
    dessert: createCourseEntry("", "", false),
    eatingOut: false,
    ingredientsEnabled: false,
    ingredients: ""
  };
}

function createSnacksEntry(items = "") {
  return { items };
}

function createDayPlan() {
  return {
    breakfast: createMealEntry(),
    lunch: createMealEntry(),
    tea: createMealEntry(),
    [SNACKS_KEY]: createSnacksEntry()
  };
}

function createEmptyPlan() {
  const plan = { [PLAN_META_KEY]: { extraDays: 0 } };
  ensureVisibleDayPlans(plan);
  return plan;
}

function normalizeMeal(meal) {
  if (!meal) return createMealEntry();

  if (meal.main || meal.starter || meal.dessert || meal.ingredients || meal.ingredientsEnabled || meal.eatingOut) {
    return {
      main: meal.main ? createCourseEntry(meal.main.name || "", meal.main.notes || "", Boolean(meal.main.visible || meal.main.name || meal.main.notes)) : createCourseEntry(),
      starter: meal.starter ? createCourseEntry(meal.starter.name || "", meal.starter.notes || "", Boolean(meal.starter.visible || meal.starter.name || meal.starter.notes)) : createCourseEntry("", "", false),
      dessert: meal.dessert ? createCourseEntry(meal.dessert.name || "", meal.dessert.notes || "", Boolean(meal.dessert.visible || meal.dessert.name || meal.dessert.notes)) : createCourseEntry("", "", false),
      eatingOut: Boolean(meal.eatingOut),
      ingredientsEnabled: Boolean(meal.ingredientsEnabled),
      ingredients: meal.ingredients || ""
    };
  }

  return {
    main: createCourseEntry(meal.name || "", meal.notes || ""),
    starter: createCourseEntry(),
    dessert: createCourseEntry(),
    eatingOut: false,
    ingredientsEnabled: false,
    ingredients: ""
  };
}

function normalizeSnacks(candidateSnacks) {
  if (!candidateSnacks) return createSnacksEntry();
  if (typeof candidateSnacks === "string") return createSnacksEntry(candidateSnacks);
  if (typeof candidateSnacks === "object") return createSnacksEntry(candidateSnacks.items || "");
  return createSnacksEntry();
}

function normalizePlanStructure(candidatePlan) {
  const plan = createEmptyPlan();
  if (!candidatePlan || typeof candidatePlan !== "object") {
    return plan;
  }

  const candidateMeta = candidatePlan[PLAN_META_KEY];
  if (candidateMeta && typeof candidateMeta === "object") {
    setExtraDays(plan, candidateMeta.extraDays);
  }

  const legacyWeekStart = getLegacyWeekStart();
  const legacyDayToDateKey = {};
  LEGACY_DAYS.forEach((dayName, index) => {
    const date = new Date(legacyWeekStart);
    date.setDate(legacyWeekStart.getDate() + index);
    legacyDayToDateKey[dayName] = toDateKey(date);
  });

  Object.entries(candidatePlan).forEach(([dayKey, sourceDay]) => {
    if (dayKey === PLAN_META_KEY || !sourceDay || typeof sourceDay !== "object") {
      return;
    }

    let normalizedDayKey = null;
    if (fromDateKey(dayKey)) {
      normalizedDayKey = dayKey;
    } else if (legacyDayToDateKey[dayKey]) {
      normalizedDayKey = legacyDayToDateKey[dayKey];
    }

    if (!normalizedDayKey) {
      return;
    }

    plan[normalizedDayKey] = {
      breakfast: normalizeMeal(sourceDay.breakfast),
      lunch: normalizeMeal(sourceDay.lunch),
      tea: normalizeMeal(sourceDay.tea),
      [SNACKS_KEY]: normalizeSnacks(sourceDay[SNACKS_KEY])
    };
  });

  ensureVisibleDayPlans(plan);
  prunePlanToVisibleDays(plan);

  return plan;
}

function loadPlan() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createEmptyPlan();
    const parsed = JSON.parse(saved);
    return normalizePlanStructure(parsed);
  } catch (error) {
    console.warn("Could not load planner data", error);
    return createEmptyPlan();
  }
}

function savePlan(plan) {
  ensureVisibleDayPlans(plan);
  prunePlanToVisibleDays(plan);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

function hasMeals(dayPlan) {
  return MEAL_KEYS.some((mealKey) => {
    const meal = dayPlan[mealKey];
    if (meal?.eatingOut) return true;
    return COURSE_KEYS.some((courseKey) => {
      const course = meal?.[courseKey];
      return course && course.name && course.name.trim() !== "";
    });
  });
}

function isTeaComplete(dayPlan) {
  const teaMeal = dayPlan?.tea;
  if (!teaMeal) return false;
  if (teaMeal.eatingOut) return true;
  return COURSE_KEYS.some((courseKey) => {
    const course = teaMeal?.[courseKey];
    return Boolean(course?.name && course.name.trim() !== "");
  });
}

function hasAnyPlanData(plan) {
  return getDataDayKeys(plan).some((day) => {
    const dayPlan = plan[day];
    return MEAL_KEYS.some((mealKey) => {
      const meal = dayPlan?.[mealKey];
      const hasMain = meal?.main?.name && meal.main.name.trim() !== "";
      const hasOptional = ["starter", "dessert"].some((courseKey) => meal?.[courseKey]?.name && meal[courseKey].name.trim() !== "");
      const hasIngredients = Boolean(meal?.ingredientsEnabled && meal.ingredients && meal.ingredients.trim() !== "");
      const hasSnacks = Boolean(dayPlan?.[SNACKS_KEY]?.items && getIngredientLines(dayPlan[SNACKS_KEY].items).length);
      return hasMain || hasOptional || hasIngredients || hasSnacks || Boolean(meal?.eatingOut);
    });
  });
}

function updateSyncStatus(message, ok = true) {
  syncState = { message, ok };
  const statusEl = document.getElementById("syncStatus");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = ok ? "#2e7d32" : "#c62828";
  }
}

function loadSupabaseSettings() {
  try {
    const saved = localStorage.getItem(SUPABASE_SETTINGS_KEY);
    if (!saved) return { url: "", key: "" };
    const parsed = JSON.parse(saved);
    return {
      url: sanitizeSupabaseUrl(parsed.url || ""),
      key: parsed.key || ""
    };
  } catch (error) {
    return { url: "", key: "" };
  }
}

function saveSupabaseSettings(settings) {
  const normalized = {
    url: sanitizeSupabaseUrl(settings.url || ""),
    key: settings.key || ""
  };
  localStorage.setItem(SUPABASE_SETTINGS_KEY, JSON.stringify(normalized));
}

function isSupabaseConfigured() {
  const settings = loadSupabaseSettings();
  return Boolean(settings.url && settings.key && window.supabase);
}

function populateSupabaseSettings() {
  const settings = loadSupabaseSettings();
  const urlInput = document.getElementById("supabaseUrl");
  const keyInput = document.getElementById("supabaseKey");
  if (urlInput) urlInput.value = settings.url || "";
  if (keyInput) keyInput.value = settings.key || "";
}

function initializeSupabaseClient() {
  const settings = loadSupabaseSettings();
  if (!settings.url || !settings.key || !window.supabase) {
    updateSyncStatus("Supabase not configured yet.", false);
    return null;
  }

  if (
    supabaseClient &&
    supabaseClientConfig &&
    supabaseClientConfig.url === settings.url &&
    supabaseClientConfig.key === settings.key
  ) {
    return supabaseClient;
  }

  supabaseClient = window.supabase.createClient(settings.url, settings.key);
  supabaseClientConfig = { ...settings };
  return supabaseClient;
}

async function loadRemotePlan() {
  const client = initializeSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.from("planner_data").select("data").eq("id", "shared").maybeSingle();
  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    throw error;
  }

  return data?.data || null;
}

async function syncToSupabase() {
  const client = initializeSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client.from("planner_data").upsert({ id: "shared", data: state, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw error;
    updateSyncStatus("Synced to Supabase.", true);
  } catch (error) {
    console.warn("Could not sync to Supabase", error);
    updateSyncStatus("Sync failed. Check your Supabase table and keys.", false);
  }
}

async function connectSupabase() {
  const rawUrl = document.getElementById("supabaseUrl")?.value || "";
  const url = sanitizeSupabaseUrl(rawUrl);
  const key = document.getElementById("supabaseKey")?.value?.trim() || "";

  const urlInput = document.getElementById("supabaseUrl");
  if (urlInput && url) {
    urlInput.value = url;
  }

  saveSupabaseSettings({ url, key });

  if (!url || !key) {
    updateSyncStatus("Add a valid Supabase URL and anon key first.", false);
    return;
  }

  updateSyncStatus("Connecting to Supabase...", true);
  const client = initializeSupabaseClient();
  if (!client) return;

  try {
    const remotePlan = await loadRemotePlan();
    if (remotePlan) {
      state = normalizePlanStructure(remotePlan);
      savePlan(state);
      renderApp();
      updateSyncStatus("Loaded the shared plan from Supabase.", true);
      return;
    }

    await syncToSupabase();
  } catch (error) {
    console.warn("Could not connect to Supabase", error);
    updateSyncStatus("Connection failed. Check URL, key and the planner_data table.", false);
  }
}

function getDaySummary(dayPlan) {
  const plannedMeals = [];

  MEAL_KEYS.forEach((mealKey) => {
    const meal = dayPlan[mealKey];
    if (meal?.eatingOut) {
      plannedMeals.push(`${mealKey}: eating out`);
      return;
    }

    const courseEntries = COURSE_KEYS.filter((courseKey) => {
      const course = meal?.[courseKey];
      return course && course.name && course.name.trim() !== "";
    }).map((courseKey) => {
      const course = meal[courseKey];
      return `${courseKey}: ${course.name}`;
    });

    if (courseEntries.length) {
      plannedMeals.push(`${mealKey}: ${courseEntries.join(" • ")}`);
    }
  });

  const snackItems = (dayPlan?.[SNACKS_KEY]?.items || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (snackItems.length) {
    plannedMeals.push(`snacks: ${snackItems.join(" • ")}`);
  }

  return plannedMeals.length ? plannedMeals.join(" • ") : "No meals yet";
}

function populateEditor(day, plan) {
  document.getElementById("editorTitle").textContent = getDisplayDayLabel(day);

  MEAL_KEYS.forEach((mealKey) => {
    const meal = normalizeMeal(plan[mealKey]);
    COURSE_KEYS.forEach((courseKey) => {
      const nameInput = document.getElementById(`${mealKey}${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Name`);
      const notesInput = document.getElementById(`${mealKey}${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Notes`);

      if (nameInput) nameInput.value = meal[courseKey]?.name || "";
      if (notesInput) notesInput.value = meal[courseKey]?.notes || "";
    });

    const ingredientsInput = document.getElementById(`${mealKey}Ingredients`);
    if (ingredientsInput) {
      ingredientsInput.value = meal.ingredients || "";
    }

    const ingredientsBlock = document.getElementById(`${mealKey}IngredientsBlock`);
    if (ingredientsBlock) {
      ingredientsBlock.hidden = !meal.ingredientsEnabled;
    }

    const eatingOutInput = document.getElementById(`${mealKey}EatingOut`);
    if (eatingOutInput) {
      eatingOutInput.checked = Boolean(meal.eatingOut);
    }
  });

  const snacksInput = document.getElementById("snacksItems");
  if (snacksInput) {
    snacksInput.value = plan[SNACKS_KEY]?.items || "";
  }

  if (plan.tea) {
    OPTIONAL_TEA_COURSES.forEach((courseKey) => {
      const block = document.getElementById(`tea${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Block`);
      const shouldShow = Boolean(plan.tea[courseKey]?.visible || plan.tea[courseKey]?.name || plan.tea[courseKey]?.notes);
      if (block) {
        block.hidden = !shouldShow;
      }
    });
  }

  if (plan.lunch) {
    OPTIONAL_LUNCH_COURSES.forEach((courseKey) => {
      const block = document.getElementById(`lunch${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Block`);
      const shouldShow = Boolean(plan.lunch[courseKey]?.visible || plan.lunch[courseKey]?.name || plan.lunch[courseKey]?.notes);
      if (block) {
        block.hidden = !shouldShow;
      }
    });
  }
}

function getIngredientLines(rawValue) {
  return (rawValue || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getShoppingList(plan) {
  const sections = [];

  getVisibleDayKeys(plan).forEach((day) => {
    const dayPlan = plan[day];
    MEAL_KEYS.forEach((mealKey) => {
      const meal = dayPlan?.[mealKey];
      if (!meal?.ingredientsEnabled) return;

      const ingredientLines = getIngredientLines(meal.ingredients || "");

      if (!ingredientLines.length) return;

      const title = `${getDisplayDayLabel(day)} - ${mealKey.charAt(0).toUpperCase() + mealKey.slice(1)}`;
      sections.push({ title, items: ingredientLines });
    });

    const snackItems = getIngredientLines(dayPlan?.[SNACKS_KEY]?.items || "");
    if (snackItems.length) {
      sections.push({ title: `${getDisplayDayLabel(day)} - Snacks`, items: snackItems });
    }
  });

  if (!sections.length) {
    return "<p>No ingredients selected yet.</p>";
  }

  const html = sections
    .map(({ title, items }) => {
      const bulletItems = items.map((item) => `<li>${item}</li>`).join("");
      return `<div class="shopping-section"><strong>${title}</strong><ul>${bulletItems}</ul></div>`;
    })
    .join("");

  return html;
}

function renderShoppingList() {
  const shoppingList = document.getElementById("shoppingList");
  if (shoppingList) {
    shoppingList.innerHTML = getShoppingList(state);
  }
}

function renderOverview(plan, selectedDay) {
  const overview = document.getElementById("overview");
  overview.innerHTML = "";

  getVisibleDayKeys(plan).forEach((day) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `day-card${selectedDay === day ? " selected" : ""}`;
    card.dataset.day = day;

    const dayPlan = plan[day];
    const statusClass = isTeaComplete(dayPlan) ? "green" : "red";
    const summary = getDaySummary(dayPlan);

    const dateLabel = getDisplayDayLabel(day);

    card.innerHTML = `
      <div class="day-row">
        <span class="day-name">${dateLabel}</span>
        <span class="status-dot ${statusClass}"></span>
      </div>
      <span class="day-summary">${summary}</span>
    `;

    overview.appendChild(card);
  });
}

let state = loadPlan();
let selectedDay = getVisibleDayKeys(state)[0];

function renderApp() {
  ensureVisibleDayPlans(state);
  prunePlanToVisibleDays(state);
  const visibleDays = getVisibleDayKeys(state);
  if (!visibleDays.includes(selectedDay)) {
    selectedDay = visibleDays[0];
  }
  renderOverview(state, selectedDay);
  populateEditor(selectedDay, state[selectedDay]);
  renderShoppingList();
}

function saveCurrentDay() {
  const dayPlan = state[selectedDay];

  dayPlan[SNACKS_KEY] = createSnacksEntry(document.getElementById("snacksItems")?.value || "");

  MEAL_KEYS.forEach((mealKey) => {
    dayPlan[mealKey] = createMealEntry();

    COURSE_KEYS.forEach((courseKey) => {
      const nameInput = document.getElementById(`${mealKey}${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Name`);
      const notesInput = document.getElementById(`${mealKey}${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Notes`);
      const isVisible = mealKey === "tea" && OPTIONAL_TEA_COURSES.includes(courseKey)
        ? Boolean(document.getElementById(`tea${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Block`) && !document.getElementById(`tea${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Block`).hidden)
        : true;

      dayPlan[mealKey][courseKey] = {
        name: nameInput ? nameInput.value : "",
        notes: notesInput ? notesInput.value : "",
        visible: isVisible
      };
    });

    const ingredientsInput = document.getElementById(`${mealKey}Ingredients`);
    const ingredientsBlock = document.getElementById(`${mealKey}IngredientsBlock`);
    const ingredientsEnabled = Boolean(ingredientsBlock && !ingredientsBlock.hidden);
    const eatingOutInput = document.getElementById(`${mealKey}EatingOut`);

    dayPlan[mealKey].ingredientsEnabled = ingredientsEnabled;
    dayPlan[mealKey].ingredients = ingredientsInput ? ingredientsInput.value : "";
    dayPlan[mealKey].eatingOut = Boolean(eatingOutInput?.checked);
  });

  savePlan(state);
  renderApp();
  syncToSupabase();
}

function handleEditorInput(event) {
  const field = event.target.dataset.field;

  if (field === "snacks") {
    state[selectedDay][SNACKS_KEY] = createSnacksEntry(event.target.value);
    savePlan(state);
    renderOverview(state, selectedDay);
    renderShoppingList();
    return;
  }

  const mealBlock = event.target.closest(".meal-block");
  if (!mealBlock) return;

  const mealKey = mealBlock.dataset.meal;
  const courseKey = event.target.dataset.course;
  const currentMeal = state[selectedDay][mealKey];

  if ((field === "name" || field === "notes") && !currentMeal[courseKey]) {
    currentMeal[courseKey] = createCourseEntry();
  }

  if (field === "name") {
    currentMeal[courseKey].name = event.target.value;
  } else if (field === "notes") {
    currentMeal[courseKey].notes = event.target.value;
  } else if (field === "ingredients") {
    currentMeal.ingredients = event.target.value;
  } else if (field === "eatingOut") {
    currentMeal.eatingOut = Boolean(event.target.checked);
  }

  if (mealKey === "tea" && OPTIONAL_TEA_COURSES.includes(courseKey)) {
    const block = document.getElementById(`tea${courseKey.charAt(0).toUpperCase() + courseKey.slice(1)}Block`);
    currentMeal[courseKey].visible = Boolean(block && !block.hidden);
  }

  savePlan(state);
  renderOverview(state, selectedDay);
  renderShoppingList();
}

function clearDay() {
  state[selectedDay] = createDayPlan();
  savePlan(state);
  renderApp();
  syncToSupabase();
}

function clearWeek() {
  state = createEmptyPlan();
  selectedDay = getVisibleDayKeys(state)[0];
  savePlan(state);
  renderApp();
  syncToSupabase();
}

function addAnotherDay() {
  setExtraDays(state, getExtraDays(state) + 1);
  ensureVisibleDayPlans(state);
  const visibleDays = getVisibleDayKeys(state);
  selectedDay = visibleDays[visibleDays.length - 1];
  savePlan(state);
  renderApp();
  syncToSupabase();
}

function attachEvents() {
  document.getElementById("plannerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveCurrentDay();
  });

  document.getElementById("clearDayButton").addEventListener("click", clearDay);
  document.getElementById("clearWeekButton").addEventListener("click", clearWeek);
  document.getElementById("addAnotherDayButton").addEventListener("click", addAnotherDay);
  document.getElementById("connectSupabaseButton").addEventListener("click", connectSupabase);
  document.getElementById("syncNowButton").addEventListener("click", () => {
    savePlan(state);
    syncToSupabase();
    renderApp();
  });

  document.getElementById("overview").addEventListener("click", (event) => {
    const dayCard = event.target.closest(".day-card");
    if (!dayCard) return;

    selectedDay = dayCard.dataset.day;
    renderApp();
  });

  document.querySelectorAll("[data-action='show-course']").forEach((button) => {
    button.addEventListener("click", () => {
      const mealKey = button.dataset.meal;
      const courseKey = button.dataset.course;
      const currentMeal = state[selectedDay][mealKey];
      currentMeal[courseKey].visible = true;
      savePlan(state);
      renderApp();
    });
  });

  document.querySelectorAll("[data-action='toggle-ingredients']").forEach((button) => {
    button.addEventListener("click", () => {
      const mealKey = button.dataset.meal;
      const currentMeal = state[selectedDay][mealKey];
      const block = document.getElementById(`${mealKey}IngredientsBlock`);
      const isVisible = block ? !block.hidden : false;
      currentMeal.ingredientsEnabled = !isVisible;
      if (block) {
        block.hidden = isVisible;
      }
      savePlan(state);
      renderApp();
    });
  });

  document.querySelectorAll("[data-action='hide-course']").forEach((button) => {
    button.addEventListener("click", () => {
      const mealKey = button.dataset.meal;
      const courseKey = button.dataset.course;
      const currentMeal = state[selectedDay][mealKey];
      currentMeal[courseKey].visible = false;
      currentMeal[courseKey].name = "";
      currentMeal[courseKey].notes = "";
      savePlan(state);
      renderApp();
    });
  });

  document.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", handleEditorInput);
    input.addEventListener("change", handleEditorInput);
  });
}

function scheduleDayRollover() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(now.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);
  const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

  window.setTimeout(() => {
    renderApp();
    savePlan(state);
    if (isSupabaseConfigured()) {
      syncToSupabase();
    }
    scheduleDayRollover();
  }, delay);
}

window.addEventListener("DOMContentLoaded", () => {
  populateSupabaseSettings();
  attachEvents();
  renderApp();
  scheduleDayRollover();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
