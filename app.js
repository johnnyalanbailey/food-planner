const STORAGE_KEY = "weekly-food-planner-v1";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEAL_KEYS = ["breakfast", "lunch", "tea"];

function getWeekDates() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() + mondayOffset);
  startOfWeek.setHours(0, 0, 0, 0);

  return DAYS.map((_, index) => {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + index);
    return date;
  });
}

function formatDayLabel(day, date) {
  return `${day} ${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
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
    ingredientsEnabled: false,
    ingredients: ""
  };
}

function createEmptyPlan() {
  const plan = {};
  DAYS.forEach((day) => {
    plan[day] = {
      breakfast: createMealEntry(),
      lunch: createMealEntry(),
      tea: createMealEntry()
    };
  });
  return plan;
}

function normalizeMeal(meal) {
  if (!meal) return createMealEntry();

  if (meal.main || meal.starter || meal.dessert || meal.ingredients || meal.ingredientsEnabled) {
    return {
      main: meal.main ? createCourseEntry(meal.main.name || "", meal.main.notes || "", Boolean(meal.main.visible || meal.main.name || meal.main.notes)) : createCourseEntry(),
      starter: meal.starter ? createCourseEntry(meal.starter.name || "", meal.starter.notes || "", Boolean(meal.starter.visible || meal.starter.name || meal.starter.notes)) : createCourseEntry("", "", false),
      dessert: meal.dessert ? createCourseEntry(meal.dessert.name || "", meal.dessert.notes || "", Boolean(meal.dessert.visible || meal.dessert.name || meal.dessert.notes)) : createCourseEntry("", "", false),
      ingredientsEnabled: Boolean(meal.ingredientsEnabled),
      ingredients: meal.ingredients || ""
    };
  }

  return {
    main: createCourseEntry(meal.name || "", meal.notes || ""),
    starter: createCourseEntry(),
    dessert: createCourseEntry(),
    ingredientsEnabled: false,
    ingredients: ""
  };
}

function loadPlan() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return createEmptyPlan();

    const parsed = JSON.parse(saved);
    const plan = createEmptyPlan();

    DAYS.forEach((day) => {
      const sourceDay = parsed[day] || {};
      plan[day] = {
        breakfast: normalizeMeal(sourceDay.breakfast),
        lunch: normalizeMeal(sourceDay.lunch),
        tea: normalizeMeal(sourceDay.tea)
      };
    });

    return plan;
  } catch (error) {
    console.warn("Could not load planner data", error);
    return createEmptyPlan();
  }
}

function savePlan(plan) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

function hasMeals(dayPlan) {
  return MEAL_KEYS.some((mealKey) => {
    const meal = dayPlan[mealKey];
    return COURSE_KEYS.some((courseKey) => {
      const course = meal?.[courseKey];
      return course && course.name && course.name.trim() !== "";
    });
  });
}

function getDaySummary(dayPlan) {
  const plannedMeals = [];

  MEAL_KEYS.forEach((mealKey) => {
    const meal = dayPlan[mealKey];
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

  return plannedMeals.length ? plannedMeals.join(" • ") : "No meals yet";
}

function populateEditor(day, plan) {
  const weekDates = getWeekDates();
  const dayIndex = DAYS.indexOf(day);
  const selectedDate = weekDates[dayIndex];
  document.getElementById("editorTitle").textContent = `${day} ${selectedDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;

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
  });

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

function getShoppingList(plan) {
  const sections = [];

  DAYS.forEach((day) => {
    const dayPlan = plan[day];
    MEAL_KEYS.forEach((mealKey) => {
      const meal = dayPlan?.[mealKey];
      if (!meal?.ingredientsEnabled) return;

      const ingredientLines = (meal.ingredients || "")
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

      if (!ingredientLines.length) return;

      const title = `${day} - ${mealKey.charAt(0).toUpperCase() + mealKey.slice(1)}`;
      sections.push({ title, items: ingredientLines });
    });
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
  const weekDates = getWeekDates();

  DAYS.forEach((day, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `day-card${selectedDay === day ? " selected" : ""}`;
    card.dataset.day = day;

    const dayPlan = plan[day];
    const statusClass = hasMeals(dayPlan) ? "green" : "red";
    const summary = getDaySummary(dayPlan);

    const dateLabel = formatDayLabel(day, weekDates[index]);

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
let selectedDay = DAYS[0];

function renderApp() {
  renderOverview(state, selectedDay);
  populateEditor(selectedDay, state[selectedDay]);
  renderShoppingList();
}

function saveCurrentDay() {
  const dayPlan = state[selectedDay];

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

    dayPlan[mealKey].ingredientsEnabled = ingredientsEnabled;
    dayPlan[mealKey].ingredients = ingredientsInput ? ingredientsInput.value : "";
  });

  savePlan(state);
  renderApp();
}

function handleEditorInput(event) {
  const mealBlock = event.target.closest(".meal-block");
  if (!mealBlock) return;

  const mealKey = mealBlock.dataset.meal;
  const courseKey = event.target.dataset.course;
  const field = event.target.dataset.field;
  const currentMeal = state[selectedDay][mealKey];

  if (!currentMeal[courseKey]) {
    currentMeal[courseKey] = createCourseEntry();
  }

  if (field === "name") {
    currentMeal[courseKey].name = event.target.value;
  } else if (field === "notes") {
    currentMeal[courseKey].notes = event.target.value;
  } else if (field === "ingredients") {
    currentMeal.ingredients = event.target.value;
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
  state[selectedDay] = {
    breakfast: createMealEntry(),
    lunch: createMealEntry(),
    tea: createMealEntry()
  };
  savePlan(state);
  renderApp();
}

function clearWeek() {
  state = createEmptyPlan();
  savePlan(state);
  renderApp();
}

function attachEvents() {
  document.getElementById("plannerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveCurrentDay();
  });

  document.getElementById("clearDayButton").addEventListener("click", clearDay);
  document.getElementById("clearWeekButton").addEventListener("click", clearWeek);

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

window.addEventListener("DOMContentLoaded", () => {
  attachEvents();
  renderApp();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
