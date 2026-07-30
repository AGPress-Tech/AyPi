type WeatherApiData = {
    current: {
        time: string;
        temperature_2m: number;
        apparent_temperature: number;
        relative_humidity_2m: number;
        weather_code: number;
        is_day: number;
        wind_speed_10m: number;
    };
    hourly: {
        time: string[];
        temperature_2m: number[];
        apparent_temperature: number[];
        relative_humidity_2m: number[];
        weather_code: number[];
        precipitation_probability: Array<number | null>;
        wind_speed_10m: number[];
    };
    daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: Array<number | null>;
        sunrise: string[];
        sunset: string[];
    };
};

type WeatherCache = {
    fetchedAt: number;
    data: WeatherApiData;
};

const WEATHER_CACHE_KEY = "aypi-bluearchive-weather-omegna-v2";
const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const WEATHER_REQUEST_TIMEOUT_MS = 10000;
const WEATHER_URL =
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=45.88&longitude=8.41" +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m" +
    "&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,precipitation_probability,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset" +
    "&timezone=Europe%2FRome&forecast_days=16";

function byId<T extends HTMLElement>(id: string) {
    return document.getElementById(id) as T | null;
}

function weatherInfo(code: number, isDay = true) {
    if (code === 0) {
        return { icon: isDay ? "☀️" : "🌙", label: "Sereno" };
    }
    if (code === 1) return { icon: isDay ? "🌤️" : "☁️", label: "Prevalentemente sereno" };
    if (code === 2) return { icon: "⛅", label: "Parzialmente nuvoloso" };
    if (code === 3) return { icon: "☁️", label: "Coperto" };
    if (code === 45 || code === 48) return { icon: "🌫️", label: "Nebbia" };
    if (code >= 51 && code <= 57) return { icon: "🌦️", label: "Pioviggine" };
    if (code >= 61 && code <= 67) return { icon: "🌧️", label: "Pioggia" };
    if (code >= 71 && code <= 77) return { icon: "❄️", label: "Neve" };
    if (code >= 80 && code <= 82) return { icon: "🌦️", label: "Rovesci" };
    if (code === 85 || code === 86) return { icon: "🌨️", label: "Rovesci di neve" };
    if (code >= 95) return { icon: "⛈️", label: "Temporale" };
    return { icon: "🌡️", label: "Condizioni variabili" };
}

function parseLocalDate(value: string) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

function dateKey(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: Date, days: number) {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
}

function formatTemperature(value: number) {
    return Number.isFinite(value) ? `${Math.round(value)}°` : "--°";
}

function formatDateLong(value: string) {
    return new Intl.DateTimeFormat("it-IT", {
        weekday: "long",
        day: "numeric",
        month: "long",
    }).format(parseLocalDate(value));
}

function formatDayName(value: string) {
    return new Intl.DateTimeFormat("it-IT", {
        weekday: "short",
    }).format(parseLocalDate(value));
}

function formatDayNumber(value: string) {
    return new Intl.DateTimeFormat("it-IT", {
        day: "2-digit",
        month: "2-digit",
    }).format(parseLocalDate(value));
}

function formatUpdateClock(timestamp: number) {
    return new Intl.DateTimeFormat("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(timestamp));
}

function formatApiTime(value: string) {
    return value.includes("T") ? value.slice(11, 16) : "--:--";
}

function isWeatherData(value: unknown): value is WeatherApiData {
    const data = value as WeatherApiData;
    return (
        !!data?.current &&
        Number.isFinite(data.current.temperature_2m) &&
        Array.isArray(data?.hourly?.time) &&
        Array.isArray(data?.daily?.time) &&
        data.daily.time.length > 0
    );
}

function setupWeatherWidget() {
    const footerButton = byId<HTMLButtonElement>("footerWeather");
    const footerIcon = byId<HTMLElement>("footerWeatherIcon");
    const footerTemperature = byId<HTMLElement>("footerWeatherTemperature");
    const backdrop = byId<HTMLElement>("weatherBackdrop");
    const closeButton = byId<HTMLButtonElement>("weatherClose");
    const refreshButton = byId<HTMLButtonElement>("weatherRefresh");
    const updateStatus = byId<HTMLElement>("weatherUpdateStatus");
    if (!footerButton || !backdrop) return;

    let weatherData: WeatherApiData | null = null;
    let lastFetchedAt = 0;
    let requestInFlight: Promise<void> | null = null;

    function setStatus(message: string, isError = false) {
        if (!updateStatus) return;
        updateStatus.classList.toggle("has-error", isError);
        updateStatus.innerHTML = `<i></i> ${message}`;
    }

    function setLoading(loading: boolean) {
        footerButton.classList.toggle("is-loading", loading);
        refreshButton?.classList.toggle("is-loading", loading);
        if (refreshButton) refreshButton.disabled = loading;
    }

    function renderHourly(data: WeatherApiData, todayKey: string) {
        const container = byId<HTMLElement>("weatherHourly");
        if (!container) return;
        const currentHour = Number(data.current.time.slice(11, 13)) || 0;
        const indices = data.hourly.time
            .map((time, index) => ({ time, index }))
            .filter(
                (entry) =>
                    entry.time.startsWith(todayKey) &&
                    Number(entry.time.slice(11, 13)) >= currentHour,
            );
        container.innerHTML = indices.length
            ? indices
                  .map(({ time, index }, position) => {
                      const info = weatherInfo(
                          Number(data.hourly.weather_code[index]),
                          Number(time.slice(11, 13)) >= 7 &&
                              Number(time.slice(11, 13)) < 21,
                      );
                      const precipitation =
                          data.hourly.precipitation_probability[index];
                      return `
                        <article class="weather-hour-card${position === 0 ? " is-now" : ""}"
                            title="${info.label}">
                            <span>${position === 0 ? "ORA" : time.slice(11, 16)}</span>
                            <i aria-hidden="true">${info.icon}</i>
                            <strong>${formatTemperature(data.hourly.temperature_2m[index])}</strong>
                            <small>Pioggia ${Number.isFinite(precipitation) ? `${precipitation}%` : "--"}</small>
                        </article>`;
                  })
                  .join("")
            : '<div class="weather-empty">Nessuna previsione oraria disponibile per oggi.</div>';
    }

    function renderDaily(
        data: WeatherApiData,
        containerId: string,
        from: Date,
        to: Date,
        todayKey: string,
    ) {
        const container = byId<HTMLElement>(containerId);
        if (!container) return;
        const fromKey = dateKey(from);
        const toKey = dateKey(to);
        const indices = data.daily.time
            .map((time, index) => ({ time, index }))
            .filter((entry) => entry.time >= fromKey && entry.time <= toKey);
        container.innerHTML = indices.length
            ? indices
                  .map(({ time, index }) => {
                      const info = weatherInfo(
                          Number(data.daily.weather_code[index]),
                      );
                      const precipitation =
                          data.daily.precipitation_probability_max[index];
                      return `
                        <button class="weather-day-card${time === todayKey ? " is-today" : ""}"
                            type="button" data-weather-date="${time}"
                            title="Apri il dettaglio di ${formatDateLong(time)}">
                            <span>${formatDayName(time)}</span>
                            <em>${formatDayNumber(time)}</em>
                            <i aria-hidden="true">${info.icon}</i>
                            <b>${formatTemperature(data.daily.temperature_2m_max[index])}
                                <small>${formatTemperature(data.daily.temperature_2m_min[index])}</small>
                            </b>
                            <small>Pioggia ${Number.isFinite(precipitation) ? `${precipitation}%` : "--"}</small>
                            <u>Dettagli</u>
                        </button>`;
                  })
                  .join("")
            : '<div class="weather-empty">Previsioni non disponibili per questo periodo.</div>';
    }

    function closeDayDetail(restoreFocus = true) {
        const detail = byId<HTMLElement>("weatherDayDetail");
        const panel = backdrop.querySelector<HTMLElement>(".weather-panel");
        const selectedDate = detail?.dataset.selectedDate;
        detail?.setAttribute("aria-hidden", "true");
        detail?.removeAttribute("data-selected-date");
        panel?.classList.remove("is-detail-open");
        if (restoreFocus && selectedDate) {
            window.setTimeout(
                () =>
                    document
                        .querySelector<HTMLButtonElement>(
                            `[data-weather-date="${selectedDate}"]`,
                        )
                        ?.focus(),
                30,
            );
        }
    }

    function openDayDetail(day: string) {
        if (!weatherData) return;
        const dailyIndex = weatherData.daily.time.indexOf(day);
        if (dailyIndex < 0) return;
        const detail = byId<HTMLElement>("weatherDayDetail");
        const panel = backdrop.querySelector<HTMLElement>(".weather-panel");
        if (!detail || !panel) return;

        const info = weatherInfo(
            Number(weatherData.daily.weather_code[dailyIndex]),
        );
        const precipitation =
            weatherData.daily.precipitation_probability_max[dailyIndex];
        const values: Array<[string, string]> = [
            ["weatherDetailDate", formatDateLong(day)],
            ["weatherDetailIcon", info.icon],
            ["weatherDetailDescription", info.label],
            [
                "weatherDetailMax",
                formatTemperature(
                    weatherData.daily.temperature_2m_max[dailyIndex],
                ),
            ],
            [
                "weatherDetailMin",
                formatTemperature(
                    weatherData.daily.temperature_2m_min[dailyIndex],
                ),
            ],
            [
                "weatherDetailRain",
                Number.isFinite(precipitation) ? `${precipitation}%` : "--%",
            ],
            [
                "weatherDetailSunrise",
                formatApiTime(weatherData.daily.sunrise[dailyIndex] || ""),
            ],
            [
                "weatherDetailSunset",
                formatApiTime(weatherData.daily.sunset[dailyIndex] || ""),
            ],
        ];
        values.forEach(([id, value]) => {
            const element = byId<HTMLElement>(id);
            if (element) element.textContent = value;
        });

        const hourly = byId<HTMLElement>("weatherDetailHourly");
        if (hourly) {
            const indices = weatherData.hourly.time
                .map((time, index) => ({ time, index }))
                .filter((entry) => entry.time.startsWith(day));
            hourly.innerHTML = indices.length
                ? indices
                      .map(({ time, index }) => {
                          const hour = Number(time.slice(11, 13));
                          const hourInfo = weatherInfo(
                              Number(weatherData!.hourly.weather_code[index]),
                              hour >= 7 && hour < 21,
                          );
                          const rain =
                              weatherData!.hourly.precipitation_probability[
                                  index
                              ];
                          const wind =
                              weatherData!.hourly.wind_speed_10m[index];
                          const humidity =
                              weatherData!.hourly.relative_humidity_2m[index];
                          const apparent =
                              weatherData!.hourly.apparent_temperature[index];
                          return `
                            <article class="weather-detail-hour-card" title="${hourInfo.label}">
                                <span>${time.slice(11, 16)}</span>
                                <i aria-hidden="true">${hourInfo.icon}</i>
                                <strong>${formatTemperature(weatherData!.hourly.temperature_2m[index])}</strong>
                                <small>Percepita ${formatTemperature(apparent)}</small>
                                <small>Pioggia ${Number.isFinite(rain) ? `${rain}%` : "--"}</small>
                                <small>Vento ${Number.isFinite(wind) ? `${Math.round(wind)} km/h` : "--"}</small>
                                <small>Umidità ${Number.isFinite(humidity) ? `${Math.round(humidity)}%` : "--"}</small>
                            </article>`;
                      })
                      .join("")
                : '<div class="weather-empty">Dettaglio orario non disponibile.</div>';
        }

        detail.dataset.selectedDate = day;
        detail.setAttribute("aria-hidden", "false");
        panel.classList.add("is-detail-open");
        detail.scrollTop = 0;
        window.setTimeout(
            () => byId<HTMLButtonElement>("weatherDetailBack")?.focus(),
            30,
        );
    }

    function renderWeather(data: WeatherApiData, fetchedAt: number) {
        weatherData = data;
        lastFetchedAt = fetchedAt;
        const current = data.current;
        const currentInfo = weatherInfo(
            Number(current.weather_code),
            current.is_day !== 0,
        );
        if (footerIcon) footerIcon.textContent = currentInfo.icon;
        if (footerTemperature) {
            footerTemperature.textContent = formatTemperature(
                current.temperature_2m,
            );
        }
        footerButton.classList.remove("has-error");
        footerButton.title = `${currentInfo.label} · ${formatTemperature(current.temperature_2m)} · Omegna`;

        const currentIcon = byId<HTMLElement>("weatherCurrentIcon");
        const currentTemperature = byId<HTMLElement>(
            "weatherCurrentTemperature",
        );
        const currentDescription = byId<HTMLElement>(
            "weatherCurrentDescription",
        );
        const feelsLike = byId<HTMLElement>("weatherFeelsLike");
        const humidity = byId<HTMLElement>("weatherHumidity");
        const wind = byId<HTMLElement>("weatherWind");
        const todayDate = byId<HTMLElement>("weatherTodayDate");
        if (currentIcon) currentIcon.textContent = currentInfo.icon;
        if (currentTemperature) {
            currentTemperature.textContent = formatTemperature(
                current.temperature_2m,
            );
        }
        if (currentDescription) {
            currentDescription.textContent = currentInfo.label;
        }
        if (feelsLike) {
            feelsLike.textContent = formatTemperature(
                current.apparent_temperature,
            );
        }
        if (humidity) {
            humidity.textContent = Number.isFinite(
                current.relative_humidity_2m,
            )
                ? `${Math.round(current.relative_humidity_2m)}%`
                : "--%";
        }
        if (wind) {
            wind.textContent = Number.isFinite(current.wind_speed_10m)
                ? `${Math.round(current.wind_speed_10m)} km/h`
                : "-- km/h";
        }

        const todayKey = current.time.slice(0, 10);
        if (todayDate) todayDate.textContent = formatDateLong(todayKey);
        const today = parseLocalDate(todayKey);
        const isoWeekDay = today.getDay() || 7;
        const currentSunday = addDays(today, 7 - isoWeekDay);
        const nextMonday = addDays(today, 8 - isoWeekDay);
        const nextSunday = addDays(nextMonday, 6);
        renderHourly(data, todayKey);
        renderDaily(
            data,
            "weatherCurrentWeek",
            today,
            currentSunday,
            todayKey,
        );
        renderDaily(
            data,
            "weatherNextWeek",
            nextMonday,
            nextSunday,
            todayKey,
        );
        setStatus(`Aggiornato alle ${formatUpdateClock(fetchedAt)} · Omegna`);
    }

    function renderUnavailable(message: string) {
        footerButton.classList.add("has-error");
        if (footerIcon) footerIcon.textContent = "⚠";
        if (footerTemperature) footerTemperature.textContent = "--°";
        footerButton.title = message;
        ["weatherHourly", "weatherCurrentWeek", "weatherNextWeek"].forEach(
            (id) => {
                const container = byId<HTMLElement>(id);
                if (container) {
                    container.innerHTML = `<div class="weather-empty">${message}</div>`;
                }
            },
        );
        setStatus(message, true);
    }

    function readCache() {
        try {
            const parsed = JSON.parse(
                window.localStorage.getItem(WEATHER_CACHE_KEY) || "null",
            ) as WeatherCache | null;
            if (
                parsed &&
                Number.isFinite(parsed.fetchedAt) &&
                isWeatherData(parsed.data)
            ) {
                renderWeather(parsed.data, parsed.fetchedAt);
                return parsed;
            }
        } catch {
            window.localStorage.removeItem(WEATHER_CACHE_KEY);
        }
        return null;
    }

    async function loadWeather(force = false) {
        if (requestInFlight) return requestInFlight;
        if (
            !force &&
            weatherData &&
            Date.now() - lastFetchedAt < WEATHER_REFRESH_MS
        ) {
            return;
        }
        requestInFlight = (async () => {
            setLoading(true);
            if (!weatherData) setStatus("Connessione al servizio meteo…");
            const controller = new AbortController();
            const timeout = window.setTimeout(
                () => controller.abort(),
                WEATHER_REQUEST_TIMEOUT_MS,
            );
            try {
                const response = await fetch(WEATHER_URL, {
                    signal: controller.signal,
                    cache: "no-store",
                });
                if (!response.ok) {
                    throw new Error(`Servizio meteo non disponibile (${response.status})`);
                }
                const data = (await response.json()) as WeatherApiData;
                if (!isWeatherData(data)) {
                    throw new Error("Risposta meteo non valida");
                }
                const fetchedAt = Date.now();
                window.localStorage.setItem(
                    WEATHER_CACHE_KEY,
                    JSON.stringify({ fetchedAt, data } satisfies WeatherCache),
                );
                renderWeather(data, fetchedAt);
            } catch (error) {
                const message =
                    error instanceof DOMException && error.name === "AbortError"
                        ? "Tempo scaduto durante l’aggiornamento meteo"
                        : error instanceof Error
                          ? error.message
                          : "Meteo momentaneamente non disponibile";
                if (weatherData) {
                    setStatus(
                        `${message} · mostrato ultimo dato delle ${formatUpdateClock(lastFetchedAt)}`,
                        true,
                    );
                    footerButton.classList.add("has-error");
                } else {
                    renderUnavailable(message);
                }
            } finally {
                window.clearTimeout(timeout);
                setLoading(false);
                requestInFlight = null;
            }
        })();
        return requestInFlight;
    }

    function openPanel() {
        backdrop.setAttribute("aria-hidden", "false");
        footerButton.setAttribute("aria-expanded", "true");
        if (Date.now() - lastFetchedAt >= WEATHER_REFRESH_MS) {
            void loadWeather();
        }
        window.setTimeout(() => closeButton?.focus(), 40);
    }

    function closePanel() {
        closeDayDetail(false);
        backdrop.setAttribute("aria-hidden", "true");
        footerButton.setAttribute("aria-expanded", "false");
        footerButton.focus();
    }

    footerButton.addEventListener("click", openPanel);
    closeButton?.addEventListener("click", closePanel);
    refreshButton?.addEventListener("click", () => void loadWeather(true));
    byId<HTMLButtonElement>("weatherDetailBack")?.addEventListener(
        "click",
        () => closeDayDetail(),
    );
    ["weatherCurrentWeek", "weatherNextWeek"].forEach((id) => {
        byId<HTMLElement>(id)?.addEventListener("click", (event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-weather-date]",
            );
            const date = target?.dataset.weatherDate;
            if (date) openDayDetail(date);
        });
    });
    backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) closePanel();
    });
    document
        .querySelectorAll<HTMLButtonElement>("[data-weather-view]")
        .forEach((tab) => {
            tab.addEventListener("click", () => {
                closeDayDetail(false);
                const view = tab.dataset.weatherView;
                document
                    .querySelectorAll<HTMLButtonElement>(
                        "[data-weather-view]",
                    )
                    .forEach((item) => {
                        const active = item === tab;
                        item.classList.toggle("active", active);
                        item.setAttribute("aria-selected", String(active));
                    });
                document
                    .querySelectorAll<HTMLElement>("[data-weather-panel]")
                    .forEach((panel) =>
                        panel.classList.toggle(
                            "active",
                            panel.dataset.weatherPanel === view,
                        ),
                    );
            });
        });
    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            backdrop.getAttribute("aria-hidden") === "false"
        ) {
            if (
                byId<HTMLElement>("weatherDayDetail")?.getAttribute(
                    "aria-hidden",
                ) === "false"
            ) {
                closeDayDetail();
            } else {
                closePanel();
            }
        }
    });

    const cache = readCache();
    if (!cache || Date.now() - cache.fetchedAt >= WEATHER_REFRESH_MS) {
        void loadWeather();
    }
    window.setInterval(() => void loadWeather(), WEATHER_REFRESH_MS);
}

export { setupWeatherWidget };
