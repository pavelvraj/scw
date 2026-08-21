(function () {
    var API_URL = "api";
    var catalogItems = [];
    var currentSearch = null;
    var currentSearchController = null;
    var currentSearchJobId = null;
    var currentSearchPollTimer = null;
    var currentRefresh = null;
    var sourceStatus = { can_search: true, message: "" };
    var selectedMediaId = null;
    var searchSort = { key: "size", direction: "desc" };
    var searchFilters = { provider: "", format: "", text: "", minSize: "", maxSize: "" };
    var refreshSort = { key: "size", direction: "desc" };
    var refreshFilters = { provider: "", format: "", text: "", minSize: "", maxSize: "" };
    var activeProgressTimer = null;
    var activeProgressStarted = 0;
    var activeProgressMode = "";
    var showIgnoredStreams = false;
    var GENRE_OPTIONS = [
        "Akční", "Animovaný", "Dobrodružný", "Dokumentární", "Drama", "Fantasy",
        "Historický", "Horor", "Komedie", "Krimi", "Mysteriózní", "Pohádka",
        "Romantický", "Rodinný", "Sci-fi", "Sportovní", "Thriller", "Válečný",
        "Western", "Životopisný"
    ];

    function el(id) {
        return document.getElementById(id);
    }

    function showStatus(message, type) {
        var node = el("status");
        if (!node) return;
        node.textContent = message || "";
        node.className = message ? "status " + (type || "info") : "status hidden";
    }

    function setSearching(isSearching) {
        var button = el("searchButton");
        if (!button) return;
        button.disabled = isSearching;
        button.textContent = isSearching ? "Hledám..." : "Hledat";
    }

    function requestJson(url, options) {
        if (!window.fetch) {
            return requestJsonXhr(url, options);
        }
        return fetch(url, options || {}).then(function (response) {
            if (!response.ok) {
                return response.text().then(function (text) {
                    throw new Error(text || ("HTTP " + response.status));
                });
            }
            return response.json();
        });
    }

    function errorMessage(error, fallback) {
        var text = error && error.message ? error.message : "";
        try {
            var data = JSON.parse(text);
            return data.detail || data.message || fallback;
        } catch (ignore) {
            return text || fallback;
        }
    }

    function requestJsonXhr(url, options) {
        options = options || {};
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(options.method || "GET", url, true);
            var headers = options.headers || {};
            Object.keys(headers).forEach(function (key) {
                xhr.setRequestHeader(key, headers[key]);
            });
            xhr.onload = function () {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error(xhr.responseText || ("HTTP " + xhr.status)));
                    return;
                }
                try {
                    resolve(JSON.parse(xhr.responseText || "{}"));
                } catch (error) {
                    reject(error);
                }
            };
            xhr.onerror = function () {
                reject(new Error("Network error"));
            };
            xhr.send(options.body || null);
        });
    }

    function formatBytes(value) {
        var bytes = Number(value || 0);
        if (!bytes) return "-";
        var units = ["B", "KB", "MB", "GB", "TB"];
        var size = bytes;
        var index = 0;
        while (size >= 1024 && index < units.length - 1) {
            size = size / 1024;
            index += 1;
        }
        return size.toFixed(index ? 1 : 0) + " " + units[index];
    }

    function formatDuration(value) {
        var seconds = Number(value || 0);
        if (!seconds) return "-";
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        return hours ? (hours + " h " + minutes + " min") : (minutes + " min");
    }

    function ratingBadge(value) {
        return '<span class="catalog-rating">' + Number(value || 0).toFixed(0) + '%</span>';
    }

    function genreBadges(genres) {
        genres = genres || [];
        if (!genres.length) return '<span class="muted-inline">Bez žánru</span>';
        return '<span class="genre-badges">' + genres.map(function (genre) {
            return '<span class="genre-badge">' + escapeHtml(genre) + '</span>';
        }).join("") + '</span>';
    }

    function normalizeGenre(value) {
        var text = String(value || "").trim();
        var lower = text.toLowerCase();
        for (var i = 0; i < GENRE_OPTIONS.length; i += 1) {
            if (GENRE_OPTIONS[i].toLowerCase() === lower) return GENRE_OPTIONS[i];
        }
        return "";
    }

    function cleanGenres(values) {
        var seen = {};
        return (values || []).map(normalizeGenre).filter(function (item) {
            if (!item || seen[item]) return false;
            seen[item] = true;
            return true;
        });
    }

    function selectedGenresFromControl(id) {
        var nodes = document.querySelectorAll('[data-genre-target="' + id + '"]:checked');
        var values = [];
        for (var i = 0; i < nodes.length; i += 1) {
            values.push(nodes[i].value);
        }
        return cleanGenres(values);
    }

    function renderGenreSelect(id, selected) {
        selected = cleanGenres(selected || []);
        var lookup = {};
        for (var i = 0; i < selected.length; i += 1) lookup[selected[i]] = true;
        return '<div id="' + escapeHtml(id) + '" class="genre-picker">' +
            GENRE_OPTIONS.map(function (genre) {
                return '<label class="genre-option ' + (lookup[genre] ? "active" : "") + '">' +
                    '<input type="checkbox" data-genre-target="' + escapeHtml(id) + '" value="' + escapeHtml(genre) + '"' + (lookup[genre] ? " checked" : "") + '>' +
                    '<span>' + escapeHtml(genre) + '</span>' +
                '</label>';
            }).join("") +
            '</div>';
    }

    function streamStats(streams, ignoredStreams) {
        var providers = {};
        var seasons = {};
        var episodes = {};
        streams = streams || [];
        ignoredStreams = ignoredStreams || [];
        for (var i = 0; i < streams.length; i += 1) {
            var stream = streams[i] || {};
            if (stream.provider) providers[stream.provider] = true;
            if (stream.season && stream.episode) {
                seasons[stream.season] = true;
                episodes[stream.season + "x" + stream.episode] = true;
            }
        }
        return {
            items: Object.keys(episodes).length || (streams.length ? 1 : 0),
            streams: streams.length,
            ignored: ignoredStreams.length,
            providers: Object.keys(providers).length,
            seasons: Object.keys(seasons).length,
            episodes: Object.keys(episodes).length,
        };
    }

    function renderProgress(label, details, stats, active) {
        stats = stats || {};
        var elapsed = stats.elapsed || (activeProgressStarted ? Math.max(1, Math.floor((Date.now() - activeProgressStarted) / 1000)) : 0);
        var stopButton = active && activeProgressMode === "search"
            ? '<button type="button" class="compact-button progress-stop" data-action="stop-search">Zastavit hledání</button>'
            : "";
        var line = "Filmů/Dílů: " + Number(stats.items || 0) +
            " · Streamů: " + Number(stats.streams || 0) +
            " · Vyfiltrováno: " + Number(stats.ignored || 0) +
            " · Čas: " + elapsed + " s" +
            " · " + (details || "");
        return '<div class="operation-progress ' + (active ? "active" : "done") + '">' +
            '<div class="progress-spinner"></div>' +
            '<div>' +
                '<strong>' + escapeHtml(label) + '</strong>' +
                '<p>' + escapeHtml(line) + '</p>' +
                stopButton +
            '</div>' +
        '</div>';
    }

    function startProgress(containerId, label, steps, mode) {
        var container = el(containerId);
        var index = 0;
        steps = steps || ["Pracuji..."];
        stopProgress();
        activeProgressMode = mode || "";
        activeProgressStarted = Date.now();
        function tick() {
            var node = el(containerId);
            if (!node) return;
            node.innerHTML = renderProgress(label, steps[index % steps.length], null, true);
            index += 1;
        }
        if (container) {
            container.classList.remove("hidden");
            tick();
        }
        activeProgressTimer = window.setInterval(tick, 1400);
    }

    function stopProgress() {
        if (activeProgressTimer) {
            window.clearInterval(activeProgressTimer);
            activeProgressTimer = null;
        }
        activeProgressStarted = 0;
        activeProgressMode = "";
    }

    function stopSearchPolling() {
        if (currentSearchPollTimer) {
            window.clearTimeout(currentSearchPollTimer);
            currentSearchPollTimer = null;
        }
    }

    function renderOperationSummary(containerId, label, details, streams, ignoredStreams) {
        var container = el(containerId);
        if (!container) return;
        var elapsed = activeProgressStarted ? Math.max(1, Math.floor((Date.now() - activeProgressStarted) / 1000)) : 0;
        var stats = streamStats(streams || [], ignoredStreams || []);
        stats.elapsed = elapsed;
        if (activeProgressTimer) {
            window.clearInterval(activeProgressTimer);
            activeProgressTimer = null;
        }
        activeProgressStarted = 0;
        activeProgressMode = "";
        container.classList.remove("hidden");
        container.innerHTML = renderProgress(label, details, stats, false);
    }

    function renderSearchJobProgress(job, label) {
        var container = el("searchProgress");
        if (!container) return;
        container.classList.remove("hidden");
        container.innerHTML = renderProgress(label || "Vyhledávání běží", job.step || "Pracuji...", {
            items: job.items || 0,
            streams: job.streams || 0,
            ignored: job.ignored || 0,
            elapsed: job.elapsed || 0,
        }, true);
    }

    function finishSearchFromJob(job) {
        var data = job.result || {};
        resetSearchTableState();
        currentSearch = data;
        currentSearchJobId = null;
        stopSearchPolling();
        renderSearchResults();
        renderOperationSummary("searchProgress", "Vyhledávání dokončeno", "Výsledky jsou připravené k filtrování, řazení a výběru.", data.streams || [], data.ignored_streams || []);
        showStatus("Vyhledávání dokončeno: " + (data.streams || []).length + " streamů, vyfiltrováno " + (data.ignored_streams || []).length + ".", "success");
        setSearching(false);
    }

    function failSearchFromJob(job) {
        var message = job.error || "Zkontroluj log add-onu.";
        currentSearchJobId = null;
        stopSearchPolling();
        stopProgress();
        if (job.result && job.result.metadata) {
            currentSearch = job.result;
            renderSearchResults();
            renderOperationSummary("searchProgress", "Vyhledávání skončilo chybou", "Zobrazuji dostupné výsledky. Chyba: " + message, job.result.streams || [], job.result.ignored_streams || []);
        } else {
            var failedPanel = el("searchPanel");
            if (failedPanel) {
                failedPanel.classList.remove("hidden");
                failedPanel.innerHTML = '<div class="empty-list">Vyhledávání skončilo chybou dřív, než server vrátil výsledky. Není tedy co zobrazit.</div>';
            }
        }
        showStatus("Vyhledávání selhalo: " + message, "error");
        setSearching(false);
    }

    function pollSearchJob(jobId) {
        requestJson(API_URL + "/search_jobs/" + encodeURIComponent(jobId))
            .then(function (job) {
                if (jobId !== currentSearchJobId) return;
                if (job.status === "done") {
                    finishSearchFromJob(job);
                    return;
                }
                if (job.status === "cancelled") {
                    currentSearchJobId = null;
                    stopSearchPolling();
                    stopProgress();
                    setSearching(false);
                    showStatus("Hledání bylo zastaveno.", "info");
                    return;
                }
                if (job.status === "error") {
                    failSearchFromJob(job);
                    return;
                }
                renderSearchJobProgress(job, "Vyhledávání běží");
                currentSearchPollTimer = window.setTimeout(function () {
                    pollSearchJob(jobId);
                }, 1000);
            })
            .catch(function (error) {
                console.error(error);
                if (jobId !== currentSearchJobId) return;
                stopSearchPolling();
                stopProgress();
                if (currentSearch && currentSearch.metadata) {
                    renderSearchResults();
                    renderOperationSummary("searchProgress", "Vyhledávání skončilo chybou", "Zobrazuji poslední dostupné výsledky. Chyba: " + errorMessage(error, "neznámá chyba"), currentSearch.streams || [], currentSearch.ignored_streams || []);
                } else {
                    var failedPanel = el("searchPanel");
                    if (failedPanel) {
                        failedPanel.classList.remove("hidden");
                        failedPanel.innerHTML = '<div class="empty-list">Spojení s průběhem hledání selhalo dřív, než se podařilo načíst výsledky.</div>';
                    }
                }
                currentSearchJobId = null;
                showStatus("Vyhledávání selhalo: " + errorMessage(error, "Zkontroluj log add-onu."), "error");
                setSearching(false);
            });
    }

    function parseGenreInput(value) {
        return cleanGenres(String(value || "").split(/[;,]/));
    }

    function renderSeriesSummary(streams) {
        var stats = streamStats(streams || []);
        if (!stats.seasons && !stats.episodes) return "";
        return '<p class="series-summary">Nalezeno: ' + stats.seasons + ' sérií · ' + stats.episodes + ' dílů · ' + stats.streams + ' streamů</p>';
    }

    function episodeMetadataLookup(metadata) {
        var lookup = {};
        var seasons = metadata && metadata.episode_metadata ? metadata.episode_metadata : [];
        for (var i = 0; i < seasons.length; i += 1) {
            var season = seasons[i] || {};
            var seasonNumber = Number(season.season || 0);
            if (!seasonNumber) continue;
            lookup["s" + seasonNumber] = season;
            var episodes = season.episodes || [];
            for (var j = 0; j < episodes.length; j += 1) {
                var episode = episodes[j] || {};
                var episodeNumber = Number(episode.episode || 0);
                if (!episodeNumber) continue;
                lookup["s" + seasonNumber + "e" + episodeNumber] = episode;
            }
        }
        return lookup;
    }

    function seasonSummaryLabel(number, seasonMeta) {
        var title = seasonMeta && seasonMeta.title ? " - " + seasonMeta.title : "";
        return "Série " + number + title;
    }

    function episodeTitleLabel(number, episodeMeta) {
        var title = episodeMeta && episodeMeta.title ? " - " + episodeMeta.title : "";
        return "Díl " + number + title;
    }

    function metadataEditScope(season, episode) {
        return "s" + season + (episode ? "e" + episode : "");
    }

    function metadataEditButton(mediaId, season, episode) {
        return '<button type="button" class="icon-button" title="Upravit metadata" data-action="open-episode-meta-edit" data-id="' + escapeHtml(mediaId) + '" data-season="' + escapeHtml(season) + '"' + (episode ? ' data-episode="' + escapeHtml(episode) + '"' : "") + '>✎</button>';
    }

    function metadataEditForm(mediaId, season, episode, meta, label) {
        var scope = metadataEditScope(season, episode);
        meta = meta || {};
        return '<div id="episodeMetaForm-' + escapeHtml(scope) + '" class="metadata-edit-form hidden">' +
            '<label>Název<input id="episodeMetaTitle-' + escapeHtml(scope) + '" type="text" value="' + escapeHtml(meta.title || "") + '"></label>' +
            '<label>Náhled<input id="episodeMetaPoster-' + escapeHtml(scope) + '" type="text" value="' + escapeHtml(meta.poster || "") + '" placeholder="https://..."></label>' +
            '<label>Popis<textarea id="episodeMetaPlot-' + escapeHtml(scope) + '" rows="3">' + escapeHtml(meta.plot || "") + '</textarea></label>' +
            '<div class="metadata-edit-actions">' +
                '<button type="button" class="icon-button" title="Uložit" data-action="save-episode-meta" data-id="' + escapeHtml(mediaId) + '" data-season="' + escapeHtml(season) + '"' + (episode ? ' data-episode="' + escapeHtml(episode) + '"' : "") + '>💾</button>' +
                '<button type="button" class="icon-button" title="Storno" data-action="cancel-episode-meta-edit" data-season="' + escapeHtml(season) + '"' + (episode ? ' data-episode="' + escapeHtml(episode) + '"' : "") + '>×</button>' +
                '<span class="muted-inline">' + escapeHtml(label || "") + '</span>' +
            '</div>' +
        '</div>';
    }

    function seasonMetaBlock(seasonMeta, mediaId, seasonNumber) {
        var scope = metadataEditScope(seasonNumber, null);
        seasonMeta = seasonMeta || {};
        if (!mediaId && !seasonMeta.poster && !seasonMeta.plot) return "";
        return '<div id="episodeMetaView-' + escapeHtml(scope) + '" class="season-meta ' + (!seasonMeta.poster && !seasonMeta.plot ? "metadata-empty" : "") + '">' +
            (seasonMeta.poster ? '<div class="season-poster"><img src="' + escapeHtml(seasonMeta.poster) + '" alt=""></div>' : '<div class="season-poster empty-thumb">Bez náhledu</div>') +
            '<div>' +
                (seasonMeta.plot ? '<p>' + escapeHtml(seasonMeta.plot) + '</p>' : '<p class="muted-inline">Bez popisu série.</p>') +
            '</div>' +
            '</div>';
    }

    function episodeMetaBlock(episodeMeta, mediaId, seasonNumber, episodeNumber) {
        var scope = metadataEditScope(seasonNumber, episodeNumber);
        episodeMeta = episodeMeta || {};
        if (!mediaId && !episodeMeta.poster && !episodeMeta.plot) return "";
        return '<div id="episodeMetaView-' + escapeHtml(scope) + '" class="episode-meta ' + (!episodeMeta.poster && !episodeMeta.plot ? "metadata-empty" : "") + '">' +
            (episodeMeta.poster ? '<div class="episode-poster"><img src="' + escapeHtml(episodeMeta.poster) + '" alt=""></div>' : '<div class="episode-poster empty-thumb">Bez náhledu</div>') +
            '<div>' +
                (episodeMeta.plot ? '<p>' + escapeHtml(episodeMeta.plot) + '</p>' : '<p class="muted-inline">Bez popisu dílu.</p>') +
            '</div>' +
        '</div>';
    }

    function providerBadge(provider) {
        var cls = provider === "webshare" ? "badge-ws" : "badge-fs";
        return '<span class="provider-badge ' + cls + '">' + escapeHtml(provider || "-") + '</span>';
    }

    function statusBadge(status) {
        var pending = status === "pending_delete";
        return '<span class="status-badge ' + (pending ? "status-pending" : "status-active") + '">' +
            (pending ? "ke vyřazení" : "aktivní") +
            '</span>';
    }

    function streamMetaLine(stream, includeDuration) {
        var parts = [
            escapeHtml(stream.format || "-"),
            formatBytes(stream.size),
            (stream.width || "-") + "x" + (stream.height || "-"),
        ];
        if (includeDuration) parts.push(formatDuration(stream.duration));
        return '<span class="stream-meta">' + parts.join(" · ") + '</span>';
    }

    function streamIdent(stream) {
        if (stream.ident && String(stream.ident).indexOf(":") > 0) return stream.ident;
        return (stream.provider || "") + ":" + (stream.provider_ident || stream.ident || "");
    }

    function streamActionButtons(stream, compact) {
        var classes = compact ? " compact-button" : "";
        return '' +
            '<button type="button" class="play-button' + classes + '" data-action="play-stream" data-ident="' + escapeHtml(streamIdent(stream)) + '" data-source-url="' + escapeHtml(stream.stream_url || "") + '" data-title="' + escapeHtml(stream.filename) + '">Přehrát</button>' +
            '<button type="button" class="download-button' + classes + '" data-action="download-stream" data-ident="' + escapeHtml(streamIdent(stream)) + '" data-source-url="' + escapeHtml(stream.stream_url || "") + '" data-title="' + escapeHtml(stream.filename) + '">Stáhnout</button>';
    }

    function resetSearchTableState() {
        searchSort = { key: "size", direction: "desc" };
        searchFilters = { provider: "", format: "", text: "", minSize: "", maxSize: "" };
    }

    function resetRefreshTableState() {
        refreshSort = { key: "size", direction: "desc" };
        refreshFilters = { provider: "", format: "", text: "", minSize: "", maxSize: "" };
    }

    function normalizeText(value) {
        return String(value || "").toLowerCase();
    }

    function parseSizeFilter(value) {
        var text = String(value || "").trim().replace(",", ".");
        var match;
        var amount;
        var unit;
        if (!text) return 0;
        match = text.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
        if (!match) return 0;
        amount = Number(match[1] || 0);
        unit = String(match[2] || "gb").toLowerCase();
        if (unit === "tb") return amount * 1024 * 1024 * 1024 * 1024;
        if (unit === "gb") return amount * 1024 * 1024 * 1024;
        if (unit === "mb") return amount * 1024 * 1024;
        if (unit === "kb") return amount * 1024;
        return amount;
    }

    function streamResolution(stream) {
        if (!stream.width && !stream.height) return "-";
        return (stream.width || "-") + "x" + (stream.height || "-");
    }

    function uniqueStreamValues(streams, key) {
        var seen = {};
        var values = [];
        for (var i = 0; i < streams.length; i += 1) {
            var value = String(streams[i][key] || "").trim();
            if (!value || seen[value]) continue;
            seen[value] = true;
            values.push(value);
        }
        return values.sort(function (a, b) { return a.localeCompare(b); });
    }

    function tableState(mode) {
        return mode === "refresh"
            ? { sort: refreshSort, filters: refreshFilters }
            : { sort: searchSort, filters: searchFilters };
    }

    function searchSortLabel(key, mode) {
        var state = tableState(mode).sort;
        if (state.key !== key) return "";
        return state.direction === "asc" ? " ▲" : " ▼";
    }

    function searchSortButton(key, label, mode) {
        if (!label) return "";
        return '<button type="button" class="sort-button" data-action="sort-stream-table" data-mode="' + escapeHtml(mode || "search") + '" data-key="' + escapeHtml(key) + '">' +
            escapeHtml(label + searchSortLabel(key, mode)) +
            '</button>';
    }

    function filteredSearchEntries(streams, mode) {
        var entries = [];
        var state = tableState(mode);
        var filters = state.filters;
        var sort = state.sort;
        var text = normalizeText(filters.text);
        var minSize = parseSizeFilter(filters.minSize);
        var maxSize = parseSizeFilter(filters.maxSize);

        for (var i = 0; i < streams.length; i += 1) {
            var entry = streams[i] && streams[i].stream ? streams[i] : { stream: streams[i], index: i };
            var stream = entry.stream;
            var size = Number(stream.size || 0);
            if (filters.provider && stream.provider !== filters.provider) continue;
            if (filters.format && String(stream.format || "") !== filters.format) continue;
            if (text && normalizeText(stream.filename).indexOf(text) < 0) continue;
            if (minSize && size < minSize) continue;
            if (maxSize && size > maxSize) continue;
            entries.push(entry);
        }

        entries.sort(function (a, b) {
            var av = searchSortValue(a.stream, sort.key);
            var bv = searchSortValue(b.stream, sort.key);
            var result;
            if (typeof av === "number" || typeof bv === "number") {
                result = Number(av || 0) - Number(bv || 0);
            } else {
                result = String(av || "").localeCompare(String(bv || ""));
            }
            return sort.direction === "asc" ? result : -result;
        });
        return entries;
    }

    function searchSortValue(stream, key) {
        if (key === "selected") return 0;
        if (key === "provider") return stream.provider || "";
        if (key === "filename") return stream.filename || "";
        if (key === "format") return stream.format || "";
        if (key === "size") return Number(stream.size || 0);
        if (key === "resolution") return Number(stream.width || 0) * Number(stream.height || 0);
        if (key === "duration") return Number(stream.duration || 0);
        if (key === "season") return Number(stream.season || 999);
        if (key === "episode") return Number(stream.episode || 999);
        return "";
    }

    function updateSearchFilter(id, key, mode) {
        var node = el(id);
        var state = tableState(mode);
        state.filters[key] = node ? node.value : "";
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function getCatalogFilter() {
        var input = el("catalogFilter");
        return input ? input.value.trim() : "";
    }

    function getTypeFilter() {
        var input = el("typeFilter");
        return input ? input.value : "all";
    }

    function renderSegmentedInput(id, value, options) {
        var html = '<input type="hidden" id="' + escapeHtml(id) + '" value="' + escapeHtml(value) + '">';
        html += '<div class="segmented" role="group">';
        for (var i = 0; i < options.length; i += 1) {
            var option = options[i];
            html += '<button type="button" class="option-button ' + (option.value === value ? "active" : "") + '" data-option-target="' +
                escapeHtml(id) + '" data-option-value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</button>';
        }
        html += '</div>';
        return html;
    }

    function loadCatalog() {
        var q = getCatalogFilter();
        var query = "media_type=" + encodeURIComponent(getTypeFilter());
        if (q) query += "&q=" + encodeURIComponent(q);

        return requestJson(API_URL + "/catalog?" + query)
            .then(function (data) {
                catalogItems = data.data || [];
                renderCatalog();
                if (!selectedMediaId && catalogItems.length) {
                    return showDetail(catalogItems[0]._id);
                }
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Nepodařilo se načíst katalog.", "error");
            });
    }

    function loadSourceStatus() {
        return requestJson(API_URL + "/source_status")
            .then(function (data) {
                sourceStatus = data || sourceStatus;
                var searchButton = el("searchButton");
                if (searchButton) searchButton.disabled = !sourceStatus.can_search;
                if (!sourceStatus.can_search) {
                    showStatus(sourceStatus.message || "Nejdřív vyplň přihlášení k Webshare nebo Fastshare v nastavení.", "error");
                }
            })
            .catch(function (error) {
                console.error(error);
            });
    }

    function renderSettingsStatus(settings) {
        var badge = el("settingsSourceStatus");
        if (!badge) return;
        var sources = [];
        if (settings && settings.webshare_configured) sources.push("Webshare");
        if (settings && settings.fastshare_configured) sources.push("Fastshare");
        badge.textContent = sources.length ? "Aktivní: " + sources.join(" + ") : "Není nastaven zdroj";
        badge.className = sources.length ? "status-badge status-active" : "status-badge status-pending";
    }

    function loadSettings() {
        return requestJson(API_URL + "/settings")
            .then(function (settings) {
                var webshareUsername = el("settingsWebshareUsername");
                var fastshareUsername = el("settingsFastshareUsername");
                var csfdApiUrl = el("settingsCsfdApiUrl");
                if (webshareUsername) webshareUsername.value = settings.webshare_username || "";
                if (fastshareUsername) fastshareUsername.value = settings.fastshare_username || "";
                if (csfdApiUrl) csfdApiUrl.value = settings.csfd_api_url || "";
                renderSettingsStatus(settings);
                return settings;
            })
            .catch(function (error) {
                showStatus(errorMessage(error, "Nastavení se nepodařilo načíst."), "error");
            });
    }

    function saveSettings(event) {
        if (event && event.preventDefault) event.preventDefault();
        var payload = {
            webshare_username: el("settingsWebshareUsername") ? el("settingsWebshareUsername").value : "",
            webshare_password: el("settingsWebsharePassword") ? el("settingsWebsharePassword").value : "",
            fastshare_username: el("settingsFastshareUsername") ? el("settingsFastshareUsername").value : "",
            fastshare_password: el("settingsFastsharePassword") ? el("settingsFastsharePassword").value : "",
            csfd_api_url: el("settingsCsfdApiUrl") ? el("settingsCsfdApiUrl").value : "",
        };
        showStatus("Ukládám nastavení…", "info");
        requestJson(API_URL + "/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        })
            .then(function (settings) {
                var websharePassword = el("settingsWebsharePassword");
                var fastsharePassword = el("settingsFastsharePassword");
                if (websharePassword) websharePassword.value = "";
                if (fastsharePassword) fastsharePassword.value = "";
                renderSettingsStatus(settings);
                return loadSourceStatus();
            })
            .then(function () {
                showStatus("Nastavení bylo uloženo. Aplikace je připravena k hledání.", "success");
            })
            .catch(function (error) {
                showStatus(errorMessage(error, "Nastavení se nepodařilo uložit."), "error");
            });
    }

    function renderCatalog() {
        var container = el("catalogList");
        if (!container) return;

        if (!catalogItems.length) {
            container.innerHTML = '<div class="empty-list">Katalog je prázdný.</div>';
            return;
        }

        container.innerHTML = catalogItems.map(function (item) {
            var active = item._id === selectedMediaId ? "active" : "";
            var poster = item.poster || "";
            var typeLabel = item.type === "tvshow" ? "Seriál" : "Film";
            return '' +
                '<button class="catalog-item ' + active + '" data-action="detail" data-id="' + escapeHtml(item._id) + '">' +
                    '<div class="thumb">' + (poster ? '<img src="' + escapeHtml(poster) + '" alt="">' : "") + '</div>' +
                    '<div class="catalog-copy">' +
                        '<strong>' + escapeHtml(item.title) + '</strong>' +
                        '<span>' + typeLabel + ' · ' + (item.year || "-") + ' · ' + (item.stream_count || 0) + ' streamů</span>' +
                        genreBadges(item.genres || []) +
                    '</div>' +
                    ratingBadge(item.rating) +
                '</button>';
        }).join("");
    }

    function searchMedia() {
        var input = el("searchInput");
        var type = el("searchType");
        var panel = el("searchPanel");
        var query = input ? input.value.trim() : "";
        var mediaType = type ? type.value : "movie";
        console.log("StreamCinema search click", query);
        if (!sourceStatus.can_search) {
            showStatus(sourceStatus.message || "Nelze vyhledávat bez přihlášení alespoň k jednomu zdroji.", "error");
            if (panel) {
                panel.classList.remove("hidden");
                panel.innerHTML = '<div class="empty-list">' + escapeHtml(sourceStatus.message || "Nejdřív vyplň přihlášení k Webshare nebo Fastshare v konfiguraci add-onu.") + '</div>';
            }
            return;
        }
        if (!query) {
            showStatus("Zadej název filmu nebo seriálu.", "error");
            return;
        }

        stopSearchPolling();
        setSearching(true);
        currentSearch = null;
        currentSearchJobId = null;
        showIgnoredStreams = false;
        showStatus("Vyhledávám streamy a metadata...", "info");
        if (panel) {
            panel.classList.remove("hidden");
            panel.innerHTML = '<div id="searchProgress"></div>';
        }
        currentSearchController = null;
        stopProgress();
        activeProgressMode = "search";
        activeProgressStarted = Date.now();
        renderSearchJobProgress({
            items: 0,
            streams: 0,
            ignored: 0,
            elapsed: 0,
            step: "Získávám metadata filmu nebo seriálu",
        }, "Vyhledávání běží");

        requestJson(API_URL + "/search_jobs?q=" + encodeURIComponent(query) + "&media_type=" + encodeURIComponent(mediaType), { method: "POST" })
            .then(function (job) {
                currentSearchJobId = job.id;
                renderSearchJobProgress(job, "Vyhledávání běží");
                pollSearchJob(job.id);
            })
            .catch(function (error) {
                console.error(error);
                currentSearchJobId = null;
                stopProgress();
                if (currentSearch && currentSearch.metadata) {
                    renderSearchResults();
                    renderOperationSummary("searchProgress", "Vyhledávání skončilo chybou", "Zobrazuji poslední dostupné výsledky. Chyba: " + errorMessage(error, "neznámá chyba"), currentSearch.streams || [], currentSearch.ignored_streams || []);
                } else {
                    var failedPanel = el("searchPanel");
                    if (failedPanel) {
                        failedPanel.classList.remove("hidden");
                        failedPanel.innerHTML = '<div class="empty-list">Vyhledávání skončilo chybou dřív, než server vrátil výsledky. Není tedy co zobrazit.</div>';
                    }
                }
                showStatus("Vyhledávání selhalo: " + errorMessage(error, "Zkontroluj log add-onu."), "error");
                setSearching(false);
            });
    }

    function stopSearch() {
        var panel = el("searchPanel");
        var input = el("searchInput");
        var jobId = currentSearchJobId;
        if (currentSearchController) {
            currentSearchController.abort();
            currentSearchController = null;
        }
        if (jobId) {
            requestJson(API_URL + "/search_jobs/" + encodeURIComponent(jobId) + "/cancel", { method: "POST" })
                .catch(function (error) {
                    console.error(error);
                });
        }
        currentSearchJobId = null;
        stopSearchPolling();
        stopProgress();
        currentSearch = null;
        setSearching(false);
        if (panel) {
            panel.innerHTML = "";
            panel.classList.add("hidden");
        }
        if (input) input.value = "";
        showStatus("Hledání bylo zastaveno a formulář výsledků vyčištěn.", "info");
    }

    function renderSearchResults() {
        var panel = el("searchPanel");
        if (!panel) return;

        var metadata = currentSearch ? currentSearch.metadata : null;
        var streams = visibleSearchStreams();
        var ignoredCount = currentSearch ? (currentSearch.ignored_streams || []).length : 0;
        if (!metadata) {
            panel.innerHTML = "";
            panel.classList.add("hidden");
            return;
        }

        var poster = metadata.poster || "";
        panel.innerHTML = '' +
            '<div id="searchProgress"></div>' +
            '<div class="search-header">' +
                '<div class="poster-small">' + (poster ? '<img src="' + escapeHtml(poster) + '" alt="">' : "") + '</div>' +
                '<div>' +
                    '<h2>' + escapeHtml(metadata.title) + '</h2>' +
                    '<p>' + (metadata.year || "-") + ' · ' + (metadata.type === "tvshow" ? "Seriál" : "Film") + ' · ' + (metadata.rating || 0) + '% · ' + String(metadata.source || "").toUpperCase() + '</p>' +
                    genreBadges(metadata.genres || []) +
                    '<p>' + escapeHtml(metadata.plot || "Bez popisu.") + '</p>' +
                '</div>' +
            '</div>' +
            '<div class="stream-actions">' +
                '<label><input type="checkbox" id="selectAllStreams"> Vybrat vše</label>' +
                '<label><input type="checkbox" id="showIgnoredStreams"' + (showIgnoredStreams ? " checked" : "") + '> Ignorované streamy (' + ignoredCount + ')</label>' +
                '<button type="button" data-action="save-selected">Zařadit vybrané do sbírky</button>' +
            '</div>' +
            '<div class="search-metadata-edit">' +
                '<label>Žánry pro uložení' + renderGenreSelect("searchGenres", metadata.genres || []) + '</label>' +
            '</div>' +
            renderSearchStreams(metadata.type, streams);

        panel.classList.remove("hidden");
    }

    function visibleSearchStreams() {
        if (!currentSearch) return [];
        var streams = (currentSearch.streams || []).slice();
        if (showIgnoredStreams) {
            streams = streams.concat(currentSearch.ignored_streams || []);
        }
        return streams;
    }

    function renderSearchStreams(mediaType, streams) {
        if (!streams.length) {
            return '<div class="empty-list">Nebyly nalezeny žádné streamy.</div>';
        }

        if (mediaType === "tvshow") {
            return renderSearchSeriesTables(streams);
        }

        return renderSearchStreamTable(streams, "", "search");
    }

    function renderSearchSeriesTables(streams) {
        var grouped = {};
        var loose = [];
        var seasons;
        var meta = episodeMetadataLookup(currentSearch ? currentSearch.metadata : null);
        var html = '<h3>Série a díly</h3>' + renderSeriesSummary(streams) + '<div class="seasons search-seasons">';

        for (var i = 0; i < streams.length; i += 1) {
            var stream = streams[i];
            if (stream.season && stream.episode) {
                if (!grouped[stream.season]) grouped[stream.season] = {};
                if (!grouped[stream.season][stream.episode]) grouped[stream.season][stream.episode] = [];
                grouped[stream.season][stream.episode].push({ stream: stream, index: i });
            } else {
                loose.push({ stream: stream, index: i });
            }
        }

        seasons = Object.keys(grouped).sort(function (a, b) { return Number(a) - Number(b); });
        if (!seasons.length) {
            return '<h3>Neroztříděné streamy</h3>' + renderSearchStreamTable(streams, "loose", "search");
        }

        for (var s = 0; s < seasons.length; s += 1) {
            var season = seasons[s];
            var episodes = Object.keys(grouped[season]).sort(function (a, b) { return Number(a) - Number(b); });
            html += '<details open><summary>' + escapeHtml(seasonSummaryLabel(season, meta["s" + season])) + '</summary>' +
                seasonMetaBlock(meta["s" + season], null, season);
            for (var e = 0; e < episodes.length; e += 1) {
                var episode = episodes[e];
                html += '<div class="episode-block"><h4>' + escapeHtml(episodeTitleLabel(episode, meta["s" + season + "e" + episode])) + '</h4>' +
                    renderSearchStreamTable(grouped[season][episode], "s" + season + "e" + episode, "search") +
                    '</div>';
            }
            html += '</details>';
        }
        html += '</div>';
        if (loose.length) {
            html += '<h3>Neroztříděné streamy</h3>' + renderSearchStreamTable(loose, "loose", "search");
        }
        return html;
    }

    function renderSearchStreamTable(streams, scope, mode) {
        var normalizedEntries = streams.map(function (entry, position) {
            if (entry && entry.stream) return entry;
            return { stream: entry, index: position };
        });
        mode = mode || "search";
        var scopeSuffix = scope ? "-" + scope : "";
        var streamValues = normalizedEntries.map(function (entry) { return entry.stream; });
        var originalCount = normalizedEntries.length;
        var formats = uniqueStreamValues(streamValues, "format");
        var providers = uniqueStreamValues(streamValues, "provider");
        var state = tableState(mode);
        var filters = state.filters;
        var entries = filteredSearchEntries(normalizedEntries, mode);
        var idPrefix = mode === "refresh" ? "refresh" : "search";
        var filterAttrs = ' data-filter-mode="' + escapeHtml(mode) + '"' + (scope ? ' data-filter-scope="' + escapeHtml(scope) + '"' : "");

        var html = '<div class="search-table-wrap"><table class="search-results-table">';
        html += '<thead>';
        html += '<tr>' +
            '<th class="check-col">' + searchSortButton("selected", "", mode) + '</th>' +
            '<th>' + searchSortButton("provider", "Zdroj", mode) + '</th>' +
            '<th>' + searchSortButton("filename", "Název", mode) + '</th>' +
            '<th>' + searchSortButton("format", "Formát", mode) + '</th>' +
            '<th>' + searchSortButton("size", "Velikost", mode) + '</th>' +
            '<th>' + searchSortButton("resolution", "Rozlišení", mode) + '</th>' +
            '<th>' + searchSortButton("duration", "Délka", mode) + '</th>' +
            '<th>Akce</th>' +
            '</tr>';
        html += '<tr class="filter-row">' +
            '<th></th>' +
            '<th><select id="' + idPrefix + 'FilterProvider' + scopeSuffix + '" data-search-filter="provider"' + filterAttrs + '><option value="">Vše</option>' + providers.map(function (provider) {
                return '<option value="' + escapeHtml(provider) + '"' + (filters.provider === provider ? " selected" : "") + '>' + escapeHtml(provider) + '</option>';
            }).join("") + '</select></th>' +
            '<th><input id="' + idPrefix + 'FilterText' + scopeSuffix + '" data-search-filter="text"' + filterAttrs + ' value="' + escapeHtml(filters.text) + '" placeholder="Filtrovat název"></th>' +
            '<th><select id="' + idPrefix + 'FilterFormat' + scopeSuffix + '" data-search-filter="format"' + filterAttrs + '><option value="">Vše</option>' + formats.map(function (format) {
                return '<option value="' + escapeHtml(format) + '"' + (filters.format === format ? " selected" : "") + '>' + escapeHtml(format) + '</option>';
            }).join("") + '</select></th>' +
            '<th><div class="size-filter"><input id="' + idPrefix + 'FilterMinSize' + scopeSuffix + '" data-search-filter="minSize"' + filterAttrs + ' value="' + escapeHtml(filters.minSize) + '" placeholder="min GB"><input id="' + idPrefix + 'FilterMaxSize' + scopeSuffix + '" data-search-filter="maxSize"' + filterAttrs + ' value="' + escapeHtml(filters.maxSize) + '" placeholder="max GB"></div></th>' +
            '<th></th>' +
            '<th></th>' +
            '<th><span class="result-count">' + entries.length + "/" + originalCount + '</span></th>' +
            '</tr>';
        html += '</thead><tbody>';
        if (!entries.length) {
            html += '<tr><td colspan="8" class="empty-table-cell">Filtr neodpovídá žádnému streamu.</td></tr>';
        } else {
            html += entries.map(function (entry) {
                var stream = entry.stream;
                var season = stream.season && stream.episode ? '<span class="episode-badge">S' + stream.season + ' E' + stream.episode + '</span>' : "";
                var ignored = stream.ignored ? '<span class="ignored-badge">ignorovaný</span>' : "";
                return '<tr class="selectable-row ' + (stream.ignored ? "ignored-row" : "") + '" data-toggle-search-index="' + entry.index + '">' +
                    '<td class="check-col"><input type="checkbox" class="search-stream-check" data-index="' + entry.index + '"></td>' +
                    '<td>' + providerBadge(stream.provider) + '</td>' +
                    '<td><strong>' + escapeHtml(stream.filename) + '</strong> ' + season + ' ' + ignored + '</td>' +
                    '<td>' + escapeHtml(stream.format || "-") + '</td>' +
                    '<td class="numeric-cell" data-sort-value="' + Number(stream.size || 0) + '">' + formatBytes(stream.size) + '</td>' +
                    '<td>' + escapeHtml(streamResolution(stream)) + '</td>' +
                    '<td class="numeric-cell">' + formatDuration(stream.duration) + '</td>' +
                    '<td><div class="table-actions">' + streamActionButtons(stream, true) + '</div></td>' +
                    '</tr>';
            }).join("");
        }
        html += '</tbody></table></div>';
        return html;
    }

    function toggleSearchStreams(checked) {
        var checks = document.querySelectorAll(".search-stream-check");
        for (var i = 0; i < checks.length; i += 1) {
            checks[i].checked = checked;
        }
    }

    function saveSelectedStreams() {
        var checks = document.querySelectorAll(".search-stream-check:checked");
        var streams = [];
        var sourceStreams = visibleSearchStreams();
        for (var i = 0; i < checks.length; i += 1) {
            streams.push(sourceStreams[Number(checks[i].getAttribute("data-index"))]);
        }

        if (!streams.length) {
            showStatus("Vyber alespoň jeden stream.", "error");
            return;
        }

        showStatus("Ukládám vybrané streamy...", "info");
        if (currentSearch && currentSearch.metadata) {
            currentSearch.metadata.genres = selectedGenresFromControl("searchGenres");
        }
        requestJson(API_URL + "/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ metadata: currentSearch.metadata, streams: streams }),
        })
            .then(function (media) {
                var panel = el("searchPanel");
                selectedMediaId = media._id;
                currentSearch = null;
                if (panel) {
                    panel.innerHTML = "";
                    panel.classList.add("hidden");
                }
                showStatus("Vybrané streamy byly zařazeny do sbírky.", "success");
                return loadCatalog().then(function () {
                    switchTab("collectionTab");
                    return showDetail(media._id);
                });
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Uložení vybraných streamů selhalo.", "error");
            });
    }

    function showDetail(mediaId) {
        selectedMediaId = mediaId;
        renderCatalog();
        return requestJson(API_URL + "/media/" + encodeURIComponent(mediaId))
            .then(function (item) {
                renderDetail(item);
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Detail se nepodařilo načíst.", "error");
            });
    }

    function renderDetail(item) {
        var poster = item.poster || "";
        var panel = el("detailPanel");
        if (!panel) return;
        var isTvshow = item.type === "tvshow";

        panel.innerHTML = '' +
            '<div class="detail-head">' +
                '<div class="poster">' + (poster ? '<img src="' + escapeHtml(poster) + '" alt="">' : "") + '</div>' +
                '<div class="detail-meta">' +
                    '<div class="detail-title-row">' +
                        '<div>' +
                            '<h2>' + escapeHtml(item.title) + '</h2>' +
                            '<p>' + (item.year || "-") + ' · ' + (item.type === "tvshow" ? "Seriál" : "Film") + '</p>' +
                            genreBadges(item.genres || []) +
                            '<p class="search-query-note">Vyhledávací dotaz: <strong>' + escapeHtml(item.search_query || item.title || "") + '</strong></p>' +
                        '</div>' +
                        '<strong class="rating">' + (item.rating || 0) + '%</strong>' +
                    '</div>' +
                    '<p class="plot">' + escapeHtml(item.plot || "Bez popisu.") + '</p>' +
                    '<div class="detail-actions">' +
                        '<button type="button" id="editMediaButton" data-action="open-media-edit">Upravit položku</button>' +
                        '<button type="button" data-action="refresh-media" data-id="' + escapeHtml(item._id) + '">Aktualizovat</button>' +
                        '<button type="button" class="danger" data-action="delete-media" data-id="' + escapeHtml(item._id) + '">Smazat položku</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<section id="mediaEditForm" class="edit-form hidden">' +
                '<h3>Upravit položku</h3>' +
                '<div class="edit-grid">' +
                    '<label>Název<input id="editTitle" type="text" value="' + escapeHtml(item.title || "") + '"></label>' +
                    '<label>Typ' + renderSegmentedInput("editType", isTvshow ? "tvshow" : "movie", [{ value: "movie", label: "Film" }, { value: "tvshow", label: "Seriál" }]) + '</label>' +
                    '<label>Hodnocení ČSFD (%)<input id="editRating" type="number" min="0" max="100" step="1" value="' + escapeHtml(item.rating || 0) + '"></label>' +
                    '<label>Žánry' + renderGenreSelect("editGenres", item.genres || []) + '</label>' +
                    '<label>Vyhledávací dotaz<input id="editSearchQuery" type="text" value="' + escapeHtml(item.search_query || item.title || "") + '"></label>' +
                    '<label>URL obrázku<input id="editPosterUrl" type="text" value="' + escapeHtml(poster) + '" placeholder="https://..."></label>' +
                    '<label>Vlastní obrázek<input id="editPosterFile" type="file" accept="image/*"></label>' +
                '</div>' +
                '<label>Popis<textarea id="editPlot" rows="5">' + escapeHtml(item.plot || "") + '</textarea></label>' +
                '<div class="edit-actions">' +
                    '<button type="button" data-action="save-media" data-id="' + escapeHtml(item._id) + '">Uložit změny</button>' +
                    '<button type="button" data-action="cancel-media-edit" data-id="' + escapeHtml(item._id) + '">Storno</button>' +
                '</div>' +
            '</section>' +
            renderStreamBulkActions(item) +
            '<section id="refreshPanel" class="refresh-panel hidden"></section>' +
            (item.type === "tvshow" ? renderSeasons(item) : renderMovieStreams(item));
    }

    function openMediaEditForm() {
        var form = el("mediaEditForm");
        var button = el("editMediaButton");
        if (form) form.classList.remove("hidden");
        if (button) button.classList.add("hidden");
    }

    function cancelMediaEdit(mediaId) {
        var form = el("mediaEditForm");
        var button = el("editMediaButton");
        if (form) form.classList.add("hidden");
        if (button) button.classList.remove("hidden");
        if (mediaId) showDetail(mediaId);
    }

    function renderStreamBulkActions(item) {
        return '' +
            '<div class="stream-toolbar">' +
                '<button type="button" data-action="check-media" data-id="' + escapeHtml(item._id) + '">Kontrola</button>' +
                '<button type="button" class="danger" data-action="delete-pending" data-id="' + escapeHtml(item._id) + '">Vyřadit označené</button>' +
            '</div>';
    }

    function renderMovieStreams(item) {
        return '<section class="collection-streams">' +
            '<h3>Streamy</h3>' +
            renderStreams(item.streams || []) +
            '</section>';
    }

    function renderSeasons(item) {
        if (!item.seasons || !item.seasons.length) {
            return '<h3>Streamy</h3>' + renderStreams(item.streams || []);
        }

        var looseStreams = (item.streams || []).filter(function (stream) {
            return !stream.season || !stream.episode;
        });
        var meta = episodeMetadataLookup(item);
        var html = '<h3>Série a díly</h3><div class="seasons">';
        html += item.seasons.map(function (season) {
            var seasonMeta = meta["s" + season.season] || season;
            return '<details open><summary><span>' + escapeHtml(seasonSummaryLabel(season.season, seasonMeta)) + '</span>' +
                metadataEditButton(item._id, season.season, null) + '</summary>' +
                seasonMetaBlock(seasonMeta, item._id, season.season) +
                metadataEditForm(item._id, season.season, null, seasonMeta, "Série " + season.season) +
                season.episodes.map(function (episode) {
                    var episodeMeta = meta["s" + season.season + "e" + episode.episode] || episode;
                    return '<div class="episode-block">' +
                        '<h4><span>' + escapeHtml(episodeTitleLabel(episode.episode, episodeMeta)) + '</span>' +
                            metadataEditButton(item._id, season.season, episode.episode) + '</h4>' +
                        episodeMetaBlock(episodeMeta, item._id, season.season, episode.episode) +
                        metadataEditForm(item._id, season.season, episode.episode, episodeMeta, "Série " + season.season + ", díl " + episode.episode) +
                        renderStreams(episode.streams) +
                    '</div>';
                }).join("") +
                '</details>';
        }).join("");
        html += '</div>';
        if (looseStreams.length) {
            html += '<h3>Nezařazené streamy</h3>' + renderStreams(looseStreams);
        }
        return html;
    }

    function renderStreams(streams) {
        if (!streams.length) {
            return '<div class="empty-list">Žádné streamy.</div>';
        }

        return '<div class="stream-table">' + streams.map(function (stream) {
            var pending = stream.status === "pending_delete";
            return '' +
                '<div class="stream-row selectable-row ' + (pending ? "pending" : "") + '" data-toggle-collection-check="' + stream.id + '">' +
                    '<input type="checkbox" class="collection-stream-check" value="' + stream.id + '"' + (pending ? " checked" : "") + '>' +
                    '<div>' +
                        '<strong>' + escapeHtml(stream.filename) + '</strong>' +
                        '<span class="stream-badges">' + providerBadge(stream.provider) + statusBadge(stream.status) + streamMetaLine(stream, true) + '</span>' +
                        '<span>' + (stream.last_checked_at ? "Kontrola " + escapeHtml(stream.last_checked_at) : "Zatím bez kontroly") + '</span>' +
                    '</div>' +
                    '<div class="row-actions">' +
                        streamActionButtons(stream, false) +
                        '<button type="button" data-action="check-stream" data-id="' + stream.id + '">Kontrola</button>' +
                        '<button type="button" class="danger" data-action="delete-stream" data-id="' + stream.id + '">Vyřadit</button>' +
                    '</div>' +
                '</div>';
        }).join("") + '</div>';
    }

    function ensurePlayerModal() {
        var modal = el("playerModal");
        if (modal) return modal;

        modal = document.createElement("section");
        modal.id = "playerModal";
        modal.className = "player-modal hidden";
        modal.innerHTML = '' +
            '<div class="player-dialog">' +
                '<div class="player-header">' +
                    '<strong id="playerTitle">Přehrávač</strong>' +
                    '<div class="player-actions">' +
                        '<button type="button" data-action="fullscreen-player">Celá obrazovka</button>' +
                        '<button type="button" data-action="close-player">Zavřít</button>' +
                    '</div>' +
                '</div>' +
                '<video id="streamPlayer" controls playsinline preload="metadata"></video>' +
                '<a id="playerOpenLink" class="button-link" target="_blank" rel="noreferrer">Otevřít link</a>' +
            '</div>';
        document.body.appendChild(modal);
        return modal;
    }

    function playStream(ident, title, sourceUrl) {
        if (!ident || ident.indexOf(":") < 1) {
            showStatus("Stream nemá identifikátor pro přehrání.", "error");
            return;
        }

        showStatus("Získávám stream link...", "info");
        var parts = ident.split(":");
        var provider = parts.shift();
        var fileIdent = parts.join(":");
        requestJson(API_URL + "/file_link/" + encodeURIComponent(provider) + ":" + encodeURIComponent(fileIdent))
            .then(function (data) {
                if (!data.link) {
                    showStatus("Provider nevrátil přímý stream link.", "error");
                    return;
                }
                if (sourceUrl && data.link.indexOf("api/stream_proxy/") === 0) {
                    data.link += "?url=" + encodeURIComponent(sourceUrl);
                }
                var modal = ensurePlayerModal();
                var player = el("streamPlayer");
                var titleNode = el("playerTitle");
                var openLink = el("playerOpenLink");
                titleNode.textContent = title || "Přehrávač";
                openLink.href = data.link;
                player.src = data.link;
                player.onerror = function () {
                    showStatus("Stream link se podařilo získat, ale přehrávač ho nedokázal načíst.", "error");
                };
                modal.className = "player-modal";
                showStatus("", "info");
                var playPromise = player.play();
                if (playPromise && playPromise.catch) {
                    playPromise.catch(function () {
                        showStatus("Přehrávač je připravený. Spusť ho tlačítkem Play.", "info");
                    });
                }
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Nepodařilo se získat stream link.", "error");
            });
    }

    function resolveStreamLink(ident, sourceUrl) {
        if (!ident || ident.indexOf(":") < 1) {
            return Promise.reject(new Error("Stream nemá identifikátor."));
        }
        var parts = ident.split(":");
        var provider = parts.shift();
        var fileIdent = parts.join(":");
        return requestJson(API_URL + "/file_link/" + encodeURIComponent(provider) + ":" + encodeURIComponent(fileIdent))
            .then(function (data) {
                if (!data.link) throw new Error("Provider nevrátil přímý stream link.");
                if (sourceUrl && data.link.indexOf("api/stream_proxy/") === 0) {
                    data.link += "?url=" + encodeURIComponent(sourceUrl);
                }
                return data.link;
            });
    }

    function downloadStream(ident, title, sourceUrl) {
        showStatus("Připravuji odkaz ke stažení...", "info");
        resolveStreamLink(ident, sourceUrl)
            .then(function (link) {
                var anchor = document.createElement("a");
                anchor.href = link;
                anchor.target = "_blank";
                anchor.rel = "noreferrer";
                anchor.download = title || "";
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                showStatus("Odkaz ke stažení byl otevřen.", "success");
            })
            .catch(function (error) {
                console.error(error);
                showStatus(errorMessage(error, "Nepodařilo se získat odkaz ke stažení."), "error");
            });
    }

    function closePlayer() {
        var modal = el("playerModal");
        var player = el("streamPlayer");
        if (player) {
            player.pause();
            player.removeAttribute("src");
            player.load();
        }
        if (modal) modal.className = "player-modal hidden";
    }

    function fullscreenPlayer() {
        var player = el("streamPlayer");
        if (!player) return;
        if (player.requestFullscreen) player.requestFullscreen();
        else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
        else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
    }

    function checkMediaStreams(mediaId) {
        showStatus("Kontroluji streamy...", "info");
        requestJson(API_URL + "/media/" + encodeURIComponent(mediaId) + "/check_streams", { method: "POST" })
            .then(function () {
                showStatus("Kontrola dokončena. Chybné streamy jsou označené a rovnou zaškrtnuté.", "success");
                return showDetail(mediaId);
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Kontrola streamů selhala.", "error");
            });
    }

    function checkStream(streamId) {
        requestJson(API_URL + "/streams/" + streamId + "/check", { method: "POST" })
            .then(function (stream) {
                showStatus(stream.status === "pending_delete" ? "Stream je nefunkční a je zaškrtnutý k vyřazení." : "Stream byl zkontrolován.", "success");
                return showDetail(selectedMediaId);
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Kontrola streamu selhala.", "error");
            });
    }

    function deleteStream(streamId) {
        if (!confirm("Opravdu vyřadit tento stream?")) return;
        requestJson(API_URL + "/streams/" + streamId, { method: "DELETE" })
            .then(function () {
                showStatus("Stream byl vyřazen.", "success");
                return loadCatalog().then(function () {
                    return showDetail(selectedMediaId);
                });
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Vyřazení streamu selhalo.", "error");
            });
    }

    function deletePendingStreams(mediaId) {
        var checks = document.querySelectorAll(".collection-stream-check:checked");
        var ids = [];
        for (var i = 0; i < checks.length; i += 1) {
            ids.push(Number(checks[i].value));
        }

        if (ids.length) {
            if (!confirm("Vyřadit vybrané streamy?")) return;
            requestJson(API_URL + "/media/" + encodeURIComponent(mediaId) + "/streams/delete_selected", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stream_ids: ids }),
            })
                .then(function (result) {
                    showStatus("Vyřazeno streamů: " + (result.deleted || 0) + ".", "success");
                    return loadCatalog().then(function () {
                        return showDetail(mediaId);
                    });
                })
                .catch(function (error) {
                    console.error(error);
                    showStatus("Vyřazení vybraných streamů selhalo.", "error");
                });
            return;
        }

        if (!confirm("Nejsou vybrané žádné streamy. Vyřadit všechny streamy označené kontrolou jako chybné?")) return;
        requestJson(API_URL + "/media/" + encodeURIComponent(mediaId) + "/pending_streams", { method: "DELETE" })
            .then(function (result) {
                showStatus("Vyřazeno streamů: " + (result.deleted || 0) + ".", "success");
                return loadCatalog().then(function () {
                    return showDetail(mediaId);
                });
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Vyřazení označených streamů selhalo.", "error");
            });
    }

    function readPosterValue() {
        var fileInput = el("editPosterFile");
        var urlInput = el("editPosterUrl");
        if (!fileInput || !fileInput.files || !fileInput.files.length) {
            return Promise.resolve(urlInput ? urlInput.value.trim() : "");
        }

        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                resolve(String(reader.result || ""));
            };
            reader.onerror = function () {
                reject(new Error("Image read failed"));
            };
            reader.readAsDataURL(fileInput.files[0]);
        });
    }

    function renderRefreshPanel(result) {
        var panel = el("refreshPanel");
        if (!panel) return;
        var streams = result.new_streams || [];
        var mediaType = result.media && result.media.type === "tvshow" ? "tvshow" : "movie";
        currentRefresh = result;
        stopProgress();
        panel.classList.remove("hidden");
        panel.innerHTML = '' +
            '<h3>Nové streamy k přidání</h3>' +
            '<p class="refresh-summary">Dotaz: <strong>' + escapeHtml(result.query || "") + '</strong> · Zachováno: ' + Number(result.kept || 0) + ' · Vyřazeno: ' + Number(result.removed || 0) + ' · Nové: ' + streams.length + '</p>' +
            (streams.length ? '<div class="stream-actions"><label><input type="checkbox" id="selectAllRefreshStreams"> Vybrat vše</label><button type="button" data-action="add-refresh-streams">Přidat vybrané streamy</button></div>' + renderRefreshStreams(mediaType, streams) : '<div class="empty-list">Aktualizace nenašla žádné nové streamy.</div>');
    }

    function renderRefreshStreams(mediaType, streams) {
        if (mediaType === "tvshow") return renderRefreshSeriesTables(streams);
        return renderSearchStreamTable(streams, "refresh", "refresh");
    }

    function renderRefreshSeriesTables(streams) {
        var grouped = {};
        var loose = [];
        var seasons;
        var meta = episodeMetadataLookup(currentRefresh ? currentRefresh.media : null);
        var html = '<h3>Série a díly</h3>' + renderSeriesSummary(streams) + '<div class="seasons search-seasons">';
        for (var i = 0; i < streams.length; i += 1) {
            var stream = streams[i];
            if (stream.season && stream.episode) {
                if (!grouped[stream.season]) grouped[stream.season] = {};
                if (!grouped[stream.season][stream.episode]) grouped[stream.season][stream.episode] = [];
                grouped[stream.season][stream.episode].push({ stream: stream, index: i });
            } else {
                loose.push({ stream: stream, index: i });
            }
        }
        seasons = Object.keys(grouped).sort(function (a, b) { return Number(a) - Number(b); });
        if (!seasons.length) return '<h3>Neroztříděné streamy</h3>' + renderSearchStreamTable(loose, "refresh-loose", "refresh");
        for (var s = 0; s < seasons.length; s += 1) {
            var season = seasons[s];
            var episodes = Object.keys(grouped[season]).sort(function (a, b) { return Number(a) - Number(b); });
            html += '<details open><summary>' + escapeHtml(seasonSummaryLabel(season, meta["s" + season])) + '</summary>' +
                seasonMetaBlock(meta["s" + season], null, season);
            for (var e = 0; e < episodes.length; e += 1) {
                var episode = episodes[e];
                html += '<div class="episode-block"><h4>' + escapeHtml(episodeTitleLabel(episode, meta["s" + season + "e" + episode])) + '</h4>' + renderSearchStreamTable(grouped[season][episode], "refresh-s" + season + "e" + episode, "refresh") + '</div>';
            }
            html += '</details>';
        }
        html += '</div>';
        if (loose.length) html += '<h3>Neroztříděné streamy</h3>' + renderSearchStreamTable(loose, "refresh-loose", "refresh");
        return html;
    }

    function refreshMedia(mediaId) {
        if (!mediaId) return;
        showStatus("Aktualizuji streamy podle uloženého dotazu...", "info");
        startProgress("refreshPanel", "Aktualizace běží", [
            "Načítám uložený vyhledávací dotaz",
            "Znovu prohledávám povolené zdroje",
            "Porovnávám nalezené streamy se sbírkou",
            "Připravuji nové streamy k výběru",
        ]);
        requestJson(API_URL + "/media/" + encodeURIComponent(mediaId) + "/refresh", { method: "POST" })
            .then(function (result) {
                resetRefreshTableState();
                showStatus("Aktualizace dokončena: zachováno " + Number(result.kept || 0) + ", vyřazeno " + Number(result.removed || 0) + ", nové " + (result.new_streams || []).length + ".", "success");
                return loadCatalog().then(function () {
                    return showDetail(mediaId).then(function () {
                        renderRefreshPanel(result);
                    });
                });
            })
            .catch(function (error) {
                console.error(error);
                stopProgress();
                showStatus(errorMessage(error, "Aktualizace streamů selhala."), "error");
            });
    }

    function addRefreshStreams() {
        if (!currentRefresh || !selectedMediaId) return;
        var checks = document.querySelectorAll("#refreshPanel .search-stream-check:checked");
        var streams = [];
        for (var i = 0; i < checks.length; i += 1) {
            streams.push(currentRefresh.new_streams[Number(checks[i].getAttribute("data-index"))]);
        }
        if (!streams.length) {
            showStatus("Vyber alespoň jeden nový stream.", "error");
            return;
        }

        showStatus("Přidávám nové streamy do existující položky...", "info");
        requestJson(API_URL + "/media/" + encodeURIComponent(selectedMediaId) + "/streams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ streams: streams }),
        })
            .then(function (result) {
                currentRefresh = null;
                showStatus("Přidáno streamů: " + Number(result.added || 0) + ".", "success");
                return loadCatalog().then(function () {
                    return showDetail(selectedMediaId);
                });
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Přidání nových streamů selhalo.", "error");
            });
    }

    function openEpisodeMetadataEdit(target) {
        var season = target.getAttribute("data-season");
        var episode = target.getAttribute("data-episode");
        var scope = metadataEditScope(season, episode);
        var view = el("episodeMetaView-" + scope);
        var form = el("episodeMetaForm-" + scope);
        if (view) view.classList.add("hidden");
        if (form) form.classList.remove("hidden");
    }

    function cancelEpisodeMetadataEdit(target) {
        var season = target.getAttribute("data-season");
        var episode = target.getAttribute("data-episode");
        var scope = metadataEditScope(season, episode);
        var view = el("episodeMetaView-" + scope);
        var form = el("episodeMetaForm-" + scope);
        if (form) form.classList.add("hidden");
        if (view) view.classList.remove("hidden");
    }

    function saveEpisodeMetadata(target) {
        var mediaId = target.getAttribute("data-id");
        var season = target.getAttribute("data-season");
        var episode = target.getAttribute("data-episode");
        var scope = metadataEditScope(season, episode);
        var title = el("episodeMetaTitle-" + scope);
        var poster = el("episodeMetaPoster-" + scope);
        var plot = el("episodeMetaPlot-" + scope);
        showStatus("Ukládám metadata série/dílu...", "info");
        requestJson(API_URL + "/media/" + encodeURIComponent(mediaId) + "/episode_metadata", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                season: Number(season),
                episode: episode ? Number(episode) : null,
                title: title ? title.value : "",
                poster: poster ? poster.value : "",
                plot: plot ? plot.value : "",
            }),
        })
            .then(function () {
                showStatus("Metadata byla uložena.", "success");
                return showDetail(mediaId);
            })
            .catch(function (error) {
                console.error(error);
                showStatus(errorMessage(error, "Uložení metadat selhalo."), "error");
            });
    }

    function saveMediaEdits(mediaId) {
        var type = el("editType");
        var title = el("editTitle");
        var searchQuery = el("editSearchQuery");
        var plot = el("editPlot");
        var rating = el("editRating");
        showStatus("Ukládám změny položky...", "info");
        readPosterValue()
            .then(function (poster) {
                return requestJson(API_URL + "/media/" + encodeURIComponent(mediaId), {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        title: title ? title.value.trim() : "",
                        type: type ? type.value : "movie",
                        genres: selectedGenresFromControl("editGenres"),
                        search_query: searchQuery ? searchQuery.value.trim() : "",
                        rating: rating ? rating.value : 0,
                        plot: plot ? plot.value : "",
                        poster: poster,
                    }),
                });
            })
            .then(function (media) {
                selectedMediaId = media._id;
                showStatus("Položka byla upravena.", "success");
                return loadCatalog().then(function () {
                    return showDetail(media._id);
                });
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Uložení změn položky selhalo.", "error");
            });
    }

    function deleteMedia(mediaId) {
        if (!confirm("Opravdu smazat celou položku ze sbírky včetně všech streamů?")) return;
        requestJson(API_URL + "/media/" + encodeURIComponent(mediaId), { method: "DELETE" })
            .then(function () {
                selectedMediaId = null;
                showStatus("Položka byla smazána.", "success");
                var panel = el("detailPanel");
                if (panel) panel.innerHTML = '<div class="empty-state">Vyber položku ze sbírky.</div>';
                return loadCatalog();
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Smazání položky selhalo.", "error");
            });
    }

    function exportDatabase() {
        showStatus("Připravuji export databáze...", "info");
        requestJson(API_URL + "/database/export")
            .then(function (data) {
                var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                var url = URL.createObjectURL(blob);
                var anchor = document.createElement("a");
                var date = new Date();
                var dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
                anchor.href = url;
                anchor.download = "streamcinema-export-" + dateStr + ".json";
                document.body.appendChild(anchor);
                anchor.click();
                document.body.removeChild(anchor);
                URL.revokeObjectURL(url);
                showStatus("Export dokončen. Soubor byl stažen.", "success");
            })
            .catch(function (error) {
                console.error(error);
                showStatus("Export databáze selhal.", "error");
            });
    }

    function importDatabase() {
        var fileInput = el("databaseImportFile");
        if (!fileInput || !fileInput.files || !fileInput.files.length) {
            showStatus("Vyberte JSON soubor k importu.", "error");
            return;
        }
        var file = fileInput.files[0];
        var formData = new FormData();
        formData.append("file", file);

        var statusEl = el("importStatus");
        if (statusEl) statusEl.textContent = "Importuji...";

        showStatus("Importuji databázi...", "info");

        if (!window.fetch) {
            showStatus("Váš prohlížeč nepodporuje File API.", "error");
            if (statusEl) statusEl.textContent = "";
            return;
        }

        fetch(API_URL + "/database/import", {
            method: "POST",
            body: formData,
        })
            .then(function (response) {
                if (!response.ok) {
                    return response.text().then(function (text) {
                        throw new Error(text || ("HTTP " + response.status));
                    });
                }
                return response.json();
            })
            .then(function (result) {
                if (statusEl) statusEl.textContent = "";
                showStatus("Import dokončen. Načteno položek: " + (result.imported || 0) + ".", "success");
                fileInput.value = "";
                return loadCatalog();
            })
            .catch(function (error) {
                console.error(error);
                if (statusEl) statusEl.textContent = "";
                showStatus("Import databáze selhal: " + errorMessage(error, "Zkontroluj formát souboru."), "error");
            });
    }

    function switchTab(tabId) {
        var pages = document.querySelectorAll(".tab-page");
        var buttons = document.querySelectorAll(".tab-button");
        for (var i = 0; i < pages.length; i += 1) {
            pages[i].className = pages[i].id === tabId ? "tab-page active" : "tab-page";
        }
        for (var j = 0; j < buttons.length; j += 1) {
            buttons[j].className = buttons[j].getAttribute("data-tab") === tabId ? "tab-button active" : "tab-button";
        }
    }

    function handleClick(event) {
        var target = closestAction(event.target);
        if (!target) return;
        var action = target.getAttribute("data-action");
        var id = target.getAttribute("data-id");

        if (action === "detail") showDetail(id);
        if (action === "save-selected") saveSelectedStreams();
        if (action === "sort-stream-table") {
            event.preventDefault();
            sortStreamTable(target.getAttribute("data-key"), target.getAttribute("data-mode") || "search");
        }
        if (action === "stop-search") stopSearch();
        if (action === "check-media") checkMediaStreams(id);
        if (action === "refresh-media") refreshMedia(id);
        if (action === "add-refresh-streams") addRefreshStreams();
        if (action === "delete-pending") deletePendingStreams(id);
        if (action === "check-stream") checkStream(id);
        if (action === "delete-stream") deleteStream(id);
        if (action === "open-media-edit") openMediaEditForm();
        if (action === "cancel-media-edit") cancelMediaEdit(id || selectedMediaId);
        if (action === "save-media") saveMediaEdits(id);
        if (action === "open-episode-meta-edit") {
            event.preventDefault();
            event.stopPropagation();
            openEpisodeMetadataEdit(target);
        }
        if (action === "cancel-episode-meta-edit") {
            event.preventDefault();
            event.stopPropagation();
            cancelEpisodeMetadataEdit(target);
        }
        if (action === "save-episode-meta") {
            event.preventDefault();
            event.stopPropagation();
            saveEpisodeMetadata(target);
        }
        if (action === "delete-media") deleteMedia(id);
        if (action === "play-stream") {
            event.preventDefault();
            playStream(target.getAttribute("data-ident"), target.getAttribute("data-title"), target.getAttribute("data-source-url"));
        }
        if (action === "download-stream") {
            event.preventDefault();
            downloadStream(target.getAttribute("data-ident"), target.getAttribute("data-title"), target.getAttribute("data-source-url"));
        }
        if (action === "close-player") closePlayer();
        if (action === "fullscreen-player") fullscreenPlayer();
        if (action === "reload-settings") loadSettings();
        if (action === "export-database") exportDatabase();
        if (action === "import-database") importDatabase();
    }

    function sortStreamTable(key, mode) {
        var state = tableState(mode);
        if (!key || key === "selected") return;
        if (state.sort.key === key) {
            state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
        } else {
            state.sort.key = key;
            state.sort.direction = key === "size" || key === "resolution" || key === "duration" ? "desc" : "asc";
        }
        rerenderStreamTable(mode);
    }

    function rerenderStreamTable(mode) {
        if (mode === "refresh") {
            renderRefreshPanel(currentRefresh || { new_streams: [] });
            return;
        }
        renderSearchResults();
    }

    function refreshSearchAfterFilter(inputId, scope) {
        var node = el(inputId);
        var mode = node && node.getAttribute ? (node.getAttribute("data-filter-mode") || "search") : "search";
        var selector = scope ? '[data-filter-scope="' + scope + '"]' : "";
        node = scope ? document.querySelector("#" + inputId + selector) : el(inputId);
        var start = node && typeof node.selectionStart === "number" ? node.selectionStart : null;
        var end = node && typeof node.selectionEnd === "number" ? node.selectionEnd : null;
        rerenderStreamTable(mode);
        node = scope ? document.querySelector("#" + inputId + selector) : el(inputId);
        if (!node) return;
        node.focus();
        if (start !== null && node.setSelectionRange) {
            node.setSelectionRange(start, end);
        }
    }

    function setOption(targetId, value) {
        var input = el(targetId);
        if (!input) return;
        input.value = value;

        var buttons = document.querySelectorAll('[data-option-target="' + targetId + '"]');
        for (var i = 0; i < buttons.length; i += 1) {
            buttons[i].className = buttons[i].getAttribute("data-option-value") === value ? "option-button active" : "option-button";
        }

        var event;
        if (typeof Event === "function") {
            event = new Event("change", { bubbles: true });
        } else {
            event = document.createEvent("Event");
            event.initEvent("change", true, true);
        }
        input.dispatchEvent(event);
    }

    function closestAction(node) {
        while (node && node !== document) {
            if (node.getAttribute && node.getAttribute("data-action")) return node;
            node = node.parentNode;
        }
        return null;
    }

    function closestRowToggle(node, attribute) {
        while (node && node !== document) {
            if (node.getAttribute && node.getAttribute(attribute) != null) return node;
            node = node.parentNode;
        }
        return null;
    }

    function shouldIgnoreRowToggle(target) {
        var tag = target && target.tagName ? target.tagName.toLowerCase() : "";
        return tag === "button" || tag === "input" || tag === "select" || tag === "textarea" || tag === "a" || tag === "label";
    }

    function toggleRowCheckbox(event) {
        var searchRow;
        var collectionRow;
        var checkbox;
        if (closestAction(event.target) || shouldIgnoreRowToggle(event.target)) return;

        searchRow = closestRowToggle(event.target, "data-toggle-search-index");
        if (searchRow) {
            checkbox = searchRow.querySelector(".search-stream-check");
            if (checkbox) checkbox.checked = !checkbox.checked;
            return;
        }

        collectionRow = closestRowToggle(event.target, "data-toggle-collection-check");
        if (collectionRow) {
            checkbox = collectionRow.querySelector(".collection-stream-check");
            if (checkbox) checkbox.checked = !checkbox.checked;
        }
    }

    function init() {
        window.streamCinemaSearch = function (event) {
            if (event && event.preventDefault) event.preventDefault();
            searchMedia();
            return false;
        };

        showStatus("GUI načteno.", "success");
        var searchForm = el("searchForm");
        var searchInput = el("searchInput");
        var typeFilter = el("typeFilter");
        var catalogFilter = el("catalogFilter");
        var settingsForm = el("settingsForm");

        if (searchForm) {
            searchForm.addEventListener("submit", function (event) {
                event.preventDefault();
                searchMedia();
            });
        }
        if (searchInput) {
            searchInput.addEventListener("keydown", function (event) {
                if (event.key === "Enter") searchMedia();
            });
        }
        if (typeFilter) typeFilter.addEventListener("change", loadCatalog);
        if (catalogFilter) catalogFilter.addEventListener("input", loadCatalog);
        if (settingsForm) settingsForm.addEventListener("submit", saveSettings);

        document.addEventListener("click", handleClick);
        document.addEventListener("click", toggleRowCheckbox);
        document.addEventListener("click", function (event) {
            var target = event.target;
            if (!target || !target.getAttribute || !target.getAttribute("data-option-target")) return;
            setOption(target.getAttribute("data-option-target"), target.getAttribute("data-option-value"));
        });
        var tabs = document.querySelectorAll(".tab-button");
        for (var i = 0; i < tabs.length; i += 1) {
            tabs[i].addEventListener("click", function () {
                switchTab(this.getAttribute("data-tab"));
            });
        }
        document.addEventListener("change", function (event) {
            if (event.target && event.target.getAttribute && event.target.getAttribute("data-genre-target")) {
                var label = event.target.parentNode;
                if (label) label.className = event.target.checked ? "genre-option active" : "genre-option";
            }
            if (event.target && event.target.id === "selectAllStreams") {
                toggleSearchStreams(event.target.checked);
            }
            if (event.target && event.target.id === "showIgnoredStreams") {
                showIgnoredStreams = event.target.checked;
                renderSearchResults();
            }
            if (event.target && event.target.id === "selectAllRefreshStreams") {
                var refreshChecks = document.querySelectorAll("#refreshPanel .search-stream-check");
                for (var r = 0; r < refreshChecks.length; r += 1) {
                    refreshChecks[r].checked = event.target.checked;
                }
            }
            if (event.target && event.target.getAttribute && event.target.getAttribute("data-search-filter")) {
                updateSearchFilter(event.target.id, event.target.getAttribute("data-search-filter"), event.target.getAttribute("data-filter-mode") || "search");
                refreshSearchAfterFilter(event.target.id, event.target.getAttribute("data-filter-scope"));
            }
        });
        document.addEventListener("input", function (event) {
            if (event.target && event.target.getAttribute && event.target.getAttribute("data-search-filter")) {
                updateSearchFilter(event.target.id, event.target.getAttribute("data-search-filter"), event.target.getAttribute("data-filter-mode") || "search");
                refreshSearchAfterFilter(event.target.id, event.target.getAttribute("data-filter-scope"));
            }
        });

        loadSettings();
        loadSourceStatus().then(loadCatalog);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
}());
