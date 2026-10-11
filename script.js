"use strict";

/* ==========================================================
   ATMOSLY: script.js
   1. Configuration
   2. DOM references
   3. Messages & custom error
   4. API functions
   5. Data validation & processing
   6. UI rendering
   7. Loading & error helpers
   8. Atmosphere (weather-reactive background)
   9. Particles (rain, snow, stars)
  10. Search handler
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- 1. CONFIGURATION ---------- */

  // Put your OpenWeather API key between the quotes.
  // WARNING: anything in frontend JavaScript can be read by visitors.
  const API_KEY = "742c1930fb80074c4d91f1828e54b5be";

  const BASE_URL = "https://api.openweathermap.org/data/2.5";
  const ICON_URL = "https://openweathermap.org/img/wn/";
  const MAX_CITY_LENGTH = 100;
  const MAX_FORECAST_DAYS = 5;

  // Temperature bands (°C) used to tune the look of the sky
  const TEMP_HOT_FROM = 32;
  const TEMP_WARM_FROM = 24;
  const TEMP_MILD_FROM = 12;


  /* ---------- 2. DOM REFERENCES ---------- */

  const searchForm = document.getElementById("search-form");
  const cityInput = document.getElementById("city-input");
  const searchButton = document.getElementById("search-button");
  const loadingMessage = document.getElementById("loading-message");
  const errorMessage = document.getElementById("error-message");

  const cityName = document.getElementById("city-name");
  const currentDate = document.getElementById("current-date");
  const weatherIcon = document.getElementById("weather-icon");
  const weatherCondition = document.getElementById("weather-condition");
  const temperature = document.getElementById("temperature");
  const feelsLike = document.getElementById("feels-like");
  const humidity = document.getElementById("humidity");
  const windSpeed = document.getElementById("wind-speed");

  const forecastHeading = document.getElementById("forecast-heading");
  const forecastContainer = document.getElementById("forecast-container");

  // Tracks whether a request is running, to block duplicate submissions
  let isLoading = false;


  /* ---------- 3. MESSAGES & CUSTOM ERROR ---------- */

  const MESSAGES = {
    emptyCity: "Please enter a city name.",
    cityTooLong: "That city name is too long. Please enter a shorter name.",
    notFound: "City not found. Please check the spelling and try again.",
    invalidKey: "The weather service rejected the API key. Please check that it is correct and active.",
    missingKey: "No API key has been set. Add your OpenWeather API key to script.js.",
    rateLimit: "Too many requests right now. Please wait a minute and try again.",
    serverError: "The weather service is having problems. Please try again later.",
    network: "Unable to connect. Please check your internet connection and try again.",
    unexpected: "We received an unexpected response from the weather service. Please try again.",
    generic: "Something went wrong while getting the weather. Please try again."
  };

  // An error whose message is safe to show directly to the user
  class WeatherError extends Error {
    constructor(message) {
      super(message);
      this.name = "WeatherError";
    }
  }

  function messageForStatus(status) {
    if (status === 404) return MESSAGES.notFound;
    if (status === 401) return MESSAGES.invalidKey;
    if (status === 429) return MESSAGES.rateLimit;
    if (status >= 500) return MESSAGES.serverError;
    return MESSAGES.generic;
  }


  /* ---------- 4. API FUNCTIONS ---------- */

  // One reusable function for both endpoints
  async function fetchWeatherData(endpoint, city) {
    const url =
      `${BASE_URL}/${endpoint}` +
      `?q=${encodeURIComponent(city)}` +
      `&units=metric` +
      `&appid=${encodeURIComponent(API_KEY)}`;

    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      // fetch() only rejects when the request could not reach the server
      console.error("Network error:", error);
      throw new WeatherError(MESSAGES.network);
    }

    // Check the status BEFORE using any data
    if (!response.ok) {
      console.error(`API error: ${response.status} (${endpoint})`);
      throw new WeatherError(messageForStatus(response.status));
    }

    try {
      return await response.json();
    } catch (error) {
      console.error("Could not read response as JSON:", error);
      throw new WeatherError(MESSAGES.unexpected);
    }
  }

  const getCurrentWeather = (city) => fetchWeatherData("weather", city);
  const getForecast = (city) => fetchWeatherData("forecast", city);


  /* ---------- 5. DATA VALIDATION & PROCESSING ---------- */

  function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isText(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  // Checks the current-weather response and returns clean values,
  // or throws if anything required is missing.
  function parseCurrentWeather(data) {
    const weather = data && Array.isArray(data.weather) ? data.weather[0] : null;

    const isValid =
      data &&
      isText(data.name) &&
      isNumber(data.dt) &&
      data.main && isNumber(data.main.temp) &&
      isNumber(data.main.feels_like) &&
      isNumber(data.main.humidity) &&
      data.wind && isNumber(data.wind.speed) &&
      weather && isText(weather.description) && isText(weather.icon);

    if (!isValid) {
      console.error("Unexpected current-weather response:", data);
      throw new WeatherError(MESSAGES.unexpected);
    }

    return {
      city: data.name,
      country: data.sys && isText(data.sys.country) ? data.sys.country : "",
      dt: data.dt,
      timezone: isNumber(data.timezone) ? data.timezone : 0,
      temp: data.main.temp,
      feelsLike: data.main.feels_like,
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      description: weather.description,
      icon: weather.icon,
      // Used only by the background (optional fields, safe if missing)
      id: isNumber(weather.id) ? weather.id : null,
      main: isText(weather.main) ? weather.main : "",
      sunrise: data.sys && isNumber(data.sys.sunrise) ? data.sys.sunrise : null,
      sunset: data.sys && isNumber(data.sys.sunset) ? data.sys.sunset : null
    };
  }

  // Converts a UTC timestamp to the city's local date, e.g. "2026-10-12"
  function getLocalDateKey(timestamp, timezoneOffset) {
    return new Date((timestamp + timezoneOffset) * 1000).toISOString().slice(0, 10);
  }

  // Turns the 3-hour forecast list into one entry per local calendar day
  function buildDailyForecast(data, todayKey) {
    if (!data || !Array.isArray(data.list)) {
      console.error("Unexpected forecast response:", data);
      throw new WeatherError(MESSAGES.unexpected);
    }

    const timezoneOffset =
      data.city && isNumber(data.city.timezone) ? data.city.timezone : 0;

    const dayMap = new Map();

    data.list.forEach((item) => {
      const weather = item && Array.isArray(item.weather) ? item.weather[0] : null;

      // Skip any entry that is missing required fields
      if (
        !item || !isNumber(item.dt) ||
        !item.main || !isNumber(item.main.temp) ||
        !weather || !isText(weather.description) || !isText(weather.icon)
      ) {
        return;
      }

      const minTemp = isNumber(item.main.temp_min) ? item.main.temp_min : item.main.temp;
      const maxTemp = isNumber(item.main.temp_max) ? item.main.temp_max : item.main.temp;

      const localTime = new Date((item.dt + timezoneOffset) * 1000);
      const key = localTime.toISOString().slice(0, 10);
      const hour = localTime.getUTCHours() + localTime.getUTCMinutes() / 60;
      const distanceFromNoon = Math.abs(hour - 12);

      const day = dayMap.get(key);

      if (!day) {
        dayMap.set(key, {
          key,
          min: minTemp,
          max: maxTemp,
          description: weather.description,
          icon: weather.icon,
          distanceFromNoon
        });
        return;
      }

      day.min = Math.min(day.min, minTemp);
      day.max = Math.max(day.max, maxTemp);

      // Representative condition: the entry closest to midday
      if (distanceFromNoon < day.distanceFromNoon) {
        day.description = weather.description;
        day.icon = weather.icon;
        day.distanceFromNoon = distanceFromNoon;
      }
    });

    let days = Array.from(dayMap.values()).sort((a, b) => a.key.localeCompare(b.key));

    // The API often returns a partial "today" plus 5 full days.
    // If we have more than 5 days, drop the partial today.
    if (days.length > MAX_FORECAST_DAYS && days[0].key === todayKey) {
      days.shift();
    }

    days = days.slice(0, MAX_FORECAST_DAYS);

    if (days.length === 0) {
      console.error("No usable forecast entries:", data);
      throw new WeatherError(MESSAGES.unexpected);
    }

    return days;
  }


  /* ---------- 6. UI RENDERING ---------- */

  const formatTemp = (value) => `${Math.round(value)}°C`;

  function formatLongDate(timestamp, timezoneOffset) {
    // Shift the timestamp by the city's offset, then read it as UTC
    return new Date((timestamp + timezoneOffset) * 1000).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  function formatDayLabel(dateKey, todayKey) {
    if (dateKey === todayKey) return "Today";
    return new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short"
    });
  }

  // Builds an <img> with safe DOM methods (no innerHTML)
  function createIconImage(iconCode, description) {
    const img = document.createElement("img");
    img.src = `${ICON_URL}${encodeURIComponent(iconCode)}@2x.png`;
    img.alt = description;
    img.width = 100;
    img.height = 100;
    return img;
  }

  function renderCurrentWeather(weather) {
    cityName.textContent = weather.country
      ? `${weather.city}, ${weather.country}`
      : weather.city;
    currentDate.textContent = formatLongDate(weather.dt, weather.timezone);
    temperature.textContent = formatTemp(weather.temp);
    weatherCondition.textContent = weather.description;
    feelsLike.textContent = formatTemp(weather.feelsLike);
    humidity.textContent = `${Math.round(weather.humidity)}%`;
    windSpeed.textContent = `${weather.windSpeed.toFixed(1)} m/s`;

    weatherIcon.replaceChildren(createIconImage(weather.icon, weather.description));
  }

  // Creates one forecast card using the same classes as the HTML
  function createForecastCard(day, todayKey) {
    const card = document.createElement("article");
    card.className = "forecast-card";

    const dayLabel = document.createElement("h3");
    dayLabel.className = "forecast-day";
    dayLabel.textContent = formatDayLabel(day.key, todayKey);

    const icon = document.createElement("div");
    icon.className = "forecast-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.appendChild(createIconImage(day.icon, day.description));

    const condition = document.createElement("p");
    condition.className = "forecast-condition";
    condition.textContent = day.description;

    const temps = document.createElement("p");
    temps.className = "forecast-temps";

    const minTemp = document.createElement("span");
    minTemp.className = "forecast-temp-min";
    minTemp.textContent = `Min: ${formatTemp(day.min)}`;

    const maxTemp = document.createElement("span");
    maxTemp.className = "forecast-temp-max";
    maxTemp.textContent = `Max: ${formatTemp(day.max)}`;

    temps.append(minTemp, maxTemp);
    card.append(dayLabel, icon, condition, temps);
    return card;
  }

  function renderForecast(days, todayKey) {
    const cards = days.map((day) => createForecastCard(day, todayKey));
    forecastContainer.replaceChildren(...cards);

    // Be honest about how many days we actually have
    forecastHeading.textContent = `${days.length}-Day Forecast`;
  }


  /* ---------- 7. LOADING & ERROR HELPERS ---------- */

  function setLoading(state) {
    isLoading = state;
    loadingMessage.hidden = !state;
    searchButton.disabled = state;
    searchForm.setAttribute("aria-busy", String(state));
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    cityInput.setAttribute("aria-invalid", "true");
  }

  function clearError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
    cityInput.removeAttribute("aria-invalid");
  }


  /* ---------- 8. ATMOSPHERE (weather-reactive background) ----------
     Turns the REAL API response into classes on <body> and switches the
     matching effect layers on. CSS does all the drawing. */

  const WEATHER_GROUPS = ["clear", "partly", "clouds", "rain", "storm", "snow", "fog"];
  const TEMP_BANDS = ["hot", "warm", "mild", "cold"];

  // Every class this feature may add, so we can remove them all before
  // applying the new weather
  const STATE_CLASSES = [
    ...WEATHER_GROUPS.map((group) => `wx-${group}`),
    ...TEMP_BANDS.map((band) => `temp-${band}`),
    "is-night",
    "is-dark-sky",
    "has-weather"
  ];

  // Effect layers in index.html (elements with data-fx="...")
  const fxLayers = {};
  document.querySelectorAll("[data-fx]").forEach((layer) => {
    fxLayers[layer.dataset.fx] = layer;
  });

  const layerTimers = {};

  // OpenWeather condition id -> one of our weather groups.
  // If the id is missing or unknown, the icon code is used instead.
  function getConditionGroup(id, icon) {
    if (isNumber(id)) {
      if (id >= 200 && id <= 232) return "storm";
      if (id >= 300 && id <= 321) return "rain";   // drizzle
      if (id >= 500 && id <= 531) return "rain";
      if (id >= 600 && id <= 622) return "snow";
      if (id >= 701 && id <= 781) return "fog";    // mist, haze, fog, dust...
      if (id === 800) return "clear";
      if (id === 801 || id === 802) return "partly";
      if (id === 803 || id === 804) return "clouds";
    }

    switch (String(icon).slice(0, 2)) {
      case "01": return "clear";
      case "02": return "partly";
      case "03":
      case "04": return "clouds";
      case "09":
      case "10": return "rain";
      case "11": return "storm";
      case "13": return "snow";
      case "50": return "fog";
      default: return null;
    }
  }

  // Icon codes end in "d" (day) or "n" (night). Sunrise/sunset is the backup.
  function isNightTime(weather) {
    const suffix = String(weather.icon).slice(-1);
    if (suffix === "n") return true;
    if (suffix === "d") return false;

    if (isNumber(weather.sunrise) && isNumber(weather.sunset)) {
      return weather.dt < weather.sunrise || weather.dt >= weather.sunset;
    }
    return false;
  }

  function getTemperatureBand(temp) {
    if (temp >= TEMP_HOT_FROM) return "hot";
    if (temp >= TEMP_WARM_FROM) return "warm";
    if (temp >= TEMP_MILD_FROM) return "mild";
    return "cold";
  }

  // How heavy the rain or snow should look
  function getIntensity(group, id) {
    if (group === "storm") {
      return [200, 210, 230].includes(id) ? "medium" : "heavy";
    }

    if (group === "rain") {
      if (id >= 300 && id <= 321) return "light";            // drizzle
      if (id === 500 || id === 520) return "light";
      if ([502, 503, 504, 522, 531].includes(id)) return "heavy";
      return "medium";
    }

    if (group === "snow") {
      if ([600, 612, 615, 620].includes(id)) return "light";
      if ([602, 622].includes(id)) return "heavy";
      return "medium";
    }

    return "medium";
  }

  // Which effect layers belong to which weather (no conflicting effects)
  function getActiveLayers(group, night, band) {
    switch (group) {
      case "clear":
        if (night) return ["stars"];
        return band === "hot" ? ["sun", "heat", "particles"] : ["sun", "particles"];
      case "partly":
        return night ? ["stars", "clouds"] : ["sun", "clouds", "particles"];
      case "clouds":
        return ["clouds"];
      case "rain":
        return ["clouds", "rain"];
      case "storm":
        return ["clouds", "rain", "lightning"];
      case "snow":
        return ["clouds", "snow"];
      case "fog":
        return ["fog"];
      default:
        return ["clouds", "particles"]; // calm default sky
    }
  }

  // Shows the wanted layers. A layer keeps animating while it fades out,
  // then pauses (so hidden effects use no CPU/GPU time).
  function setActiveLayers(names) {
    Object.keys(fxLayers).forEach((name) => {
      const layer = fxLayers[name];
      window.clearTimeout(layerTimers[name]);

      if (names.includes(name)) {
        layer.classList.add("is-running", "is-active");
      } else {
        layer.classList.remove("is-active");
        layerTimers[name] = window.setTimeout(() => {
          layer.classList.remove("is-running");
        }, 1400);
      }
    });
  }

  function applyAtmosphere(weather) {
    document.body.classList.toggle("temp-cold", weather.temp < 0);
    const group = getConditionGroup(weather.id, weather.icon);
    const night = isNightTime(weather);
    const band = getTemperatureBand(weather.temp);
    const intensity = getIntensity(group, weather.id);
    const body = document.body;

    // 1. Remove everything from the previous weather
    body.classList.remove(...STATE_CLASSES);

    if (fxLayers.rain) fxLayers.rain.dataset.intensity = intensity;
    if (fxLayers.snow) fxLayers.snow.dataset.intensity = intensity;

    // 2. Unknown condition: calm default sky, nothing invented
    if (!group) {
      setActiveLayers(getActiveLayers(null, false, band));
      return;
    }

    // 3. Add the classes for the new weather
    body.classList.add("has-weather", `wx-${group}`, `temp-${band}`);
    if (night) body.classList.add("is-night");
    if (night || group === "rain" || group === "storm") body.classList.add("is-dark-sky");

    // 4. Switch the effect layers
    setActiveLayers(getActiveLayers(group, night, band));

    // Helpful when testing: shows what the API sent and what we chose
    console.info("Atmosly sky:", {
      id: weather.id,
      main: weather.main,
      icon: weather.icon,
      temp: weather.temp,
      group,
      night,
      band,
      intensity
    });
  }


  /* ---------- 9. PARTICLES (rain, snow, stars) ----------
     Created once. CSS controls which are visible and how they move. */

  const random = (min, max) => Math.random() * (max - min) + min;

  function populate(layer, count, createItem) {
    if (!layer) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i += 1) {
      fragment.appendChild(createItem());
    }
    layer.appendChild(fragment);
  }

  function createRaindrop() {
    const duration = random(0.8, 1.4);
    const drop = document.createElement("span");
    drop.className = "raindrop";
    drop.style.setProperty("--x", random(-5, 125).toFixed(1));
    drop.style.setProperty("--y", random(0, 100).toFixed(1));
    drop.style.setProperty("--h", `${Math.round(random(40, 95))}px`);
    drop.style.setProperty("--o", random(0.35, 0.8).toFixed(2));
    drop.style.setProperty("--dur", `${duration.toFixed(2)}s`);
    drop.style.setProperty("--delay", `-${random(0, duration).toFixed(2)}s`);
    return drop;
  }

  function createSnowflake() {
    const size = random(3, 9);
    // Bigger flakes fall a little faster than small ones
    const duration = 22 - size * 1.5 + random(0, 4);
    const flake = document.createElement("span");
    flake.className = "snowflake";
    flake.style.setProperty("--x", random(0, 100).toFixed(1));
    flake.style.setProperty("--y", random(0, 100).toFixed(1));
    flake.style.setProperty("--size", `${size.toFixed(1)}px`);
    flake.style.setProperty("--o", random(0.6, 0.95).toFixed(2));
    flake.style.setProperty("--dur", `${duration.toFixed(1)}s`);
    flake.style.setProperty("--delay", `-${random(0, duration).toFixed(1)}s`);
    flake.style.setProperty("--sway", `${random(3, 6).toFixed(1)}s`);
    flake.style.setProperty("--drift", `${Math.round(random(-70, 70))}px`);
    return flake;
  }

  function createStar() {
    const star = document.createElement("span");
    star.className = "star";
    star.style.setProperty("--x", random(0, 100).toFixed(1));
    star.style.setProperty("--y", random(0, 70).toFixed(1));
    star.style.setProperty("--s", `${random(1, 2.6).toFixed(1)}px`);
    star.style.setProperty("--o", random(0.5, 1).toFixed(2));
    star.style.setProperty("--dur", `${random(2.5, 6).toFixed(1)}s`);
    star.style.setProperty("--delay", `-${random(0, 5).toFixed(1)}s`);
    return star;
  }

  populate(fxLayers.rain, 110, createRaindrop);
  populate(fxLayers.snow, 80, createSnowflake);
  populate(fxLayers.stars, 60, createStar);

  // Calm default sky until the first successful search
  setActiveLayers(getActiveLayers(null, false, "mild"));


  /* ---------- 10. SEARCH HANDLER ---------- */

  async function handleSearch(event) {
    event.preventDefault(); // stop the page from reloading

    if (isLoading) return; // ignore duplicate submissions

    // Trim edges and collapse repeated inner spaces
    const city = cityInput.value.trim().replace(/\s+/g, " ");

    if (city === "") {
      showError(MESSAGES.emptyCity);
      cityInput.focus();
      return; // no API request is sent
    }

    if (city.length > MAX_CITY_LENGTH) {
      showError(MESSAGES.cityTooLong);
      cityInput.focus();
      return;
    }

    if (API_KEY === "YOUR_API_KEY_HERE" || API_KEY.trim() === "") {
      showError(MESSAGES.missingKey);
      return;
    }

    clearError();
    setLoading(true);

    try {
      // Run both requests at the same time
      const [currentData, forecastData] = await Promise.all([
        getCurrentWeather(city),
        getForecast(city)
      ]);

      // Validate everything first, so the page is never half-updated
      const current = parseCurrentWeather(currentData);
      const todayKey = getLocalDateKey(current.dt, current.timezone);
      const days = buildDailyForecast(forecastData, todayKey);

      renderCurrentWeather(current);
      renderForecast(days, todayKey);

      // Background only changes after a fully successful search.
      // A problem in the visuals must never break the weather display.
      try {
        applyAtmosphere(current);
      } catch (visualError) {
        console.error("Could not update the background:", visualError);
      }
    } catch (error) {
      const message = error instanceof WeatherError ? error.message : MESSAGES.generic;
      if (!(error instanceof WeatherError)) {
        console.error("Unexpected error:", error);
      }
      showError(message);
    } finally {
      // Runs after success AND failure
      setLoading(false);
    }
  }

  // Turn off the browser's own "required" bubble so whitespace-only input
  // and empty input both show the same friendly message
  searchForm.noValidate = true;
  searchForm.addEventListener("submit", handleSearch);
});