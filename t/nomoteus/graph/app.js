const stage = document.getElementById("graph-stage");
const svg = d3.select("#graph");
const statusElement = document.getElementById("status");
const counterElement = document.getElementById("counter");
const searchInput = document.getElementById("search");
const graphModeSelect = document.getElementById("graph-mode");
const graphModeButton = document.getElementById("graph-mode-button");
const graphModeLabel = document.getElementById("graph-mode-label");
const graphModeMenu = document.getElementById("graph-mode-menu");
const graphModeDescription = document.getElementById("graph-mode-description");
const dossier = document.getElementById("dossier");
const portraitModal = document.getElementById("portrait-modal");
const portraitModalImage = document.getElementById("portrait-modal-image");
const portraitModalClose = document.getElementById("portrait-modal-close");
const tagModal = document.getElementById("tag-modal");
const tagModalTitle = document.getElementById("tag-modal-title");
const tagModalDescription = document.getElementById("tag-modal-description");
const tagModalClose = document.getElementById("tag-modal-close");

const remoteDataRoot = "https://vsnvsu.github.io/t/nomoteus/data/";
const dataRoot = location.protocol === "file:"
    ? remoteDataRoot
    : "../data/";
const charactersDataBase = `${dataRoot}characters/`;
const graphsDataBase = `${dataRoot}graphs/`;
const tagsDataBase = `${dataRoot}tags/`;
const keysDataBase = `${dataRoot}keys/`;
const tokensBase = location.protocol === "file:"
    ? "https://vsnvsu.github.io/assets/tokens/"
    : "../../../assets/tokens/";
const artsBase = location.protocol === "file:"
    ? "https://vsnvsu.github.io/assets/arts/"
    : "../../../assets/arts/";

const allowedRelationClasses = new Set([
    "family",
    "work",
    "rivalry",
    "alliance",
    "debt",
    "mentorship",
]);

const color = d3.scaleOrdinal([
    "#c7ff68",
    "#6de1ff",
    "#ff9f68",
    "#d898ff",
    "#ff769d",
    "#88a7ff",
    "#ffe16d",
]);

let allCharacters = [];
let allTags = [];
let allKeys = [];
let characters = [];
let nodes = [];
let graphModes = [];
let links = [];
let simulation;
let zoom;
let graphRoot;
let linkSelection;
let linkLabelSelection;
let nodeSelection;
let selectedId = null;
let excludedRelationClasses = new Set();

function renderEmptyDossier() {
    dossier.innerHTML = `
        <div class="dossier-empty">
            <span class="empty-mark">N</span>
            <h2>Выберите персонажа</h2>
            <p>Нажмите на узел, чтобы открыть карточку, описание и список его связей.</p>
        </div>
    `;
}

function clearSelection() {
    if (!selectedId) {
        return;
    }

    selectedId = null;
    renderEmptyDossier();
    updateHighlight();
}

function initials(name) {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toLocaleUpperCase("ru");
}

function portraitUrl(path) {
    return path ? `${tokensBase}${path.replace(/^\/+/, "")}` : "";
}

function artUrl(path) {
    return path ? `${artsBase}${path.replace(/^\/+/, "")}` : "";
}

function openPortraitModal(character) {
    if (!character.portrait && !character.art) {
        return;
    }

    const imageUrl = character.art
        ? artUrl(character.art)
        : portraitUrl(character.portrait);
    portraitModalImage.dataset.fallback = character.art
        ? portraitUrl(character.portrait)
        : "";
    portraitModalImage.src = imageUrl;
    portraitModalImage.alt = character.art
        ? `Иллюстрация: ${character.name}`
        : `Портрет: ${character.name}`;
    portraitModal.showModal();
}

function closePortraitModal() {
    portraitModal.close();
    portraitModalImage.removeAttribute("src");
    delete portraitModalImage.dataset.fallback;
    portraitModalImage.alt = "";
}

function openTagModal(tagId) {
    const tag = allTags.find((item) => item.id === tagId);
    if (!tag) {
        return;
    }

    tagModalTitle.textContent = tag.name;
    tagModalDescription.textContent = tag.description;
    tagModal.showModal();
}

function closeTagModal() {
    tagModal.close();
    tagModalTitle.textContent = "";
    tagModalDescription.textContent = "";
}

function normalizeRelationType(type) {
    const normalized = String(type || "").toLocaleLowerCase("ru");
    const aliases = {
        asc: "ascending",
        desc: "descending",
        ascending: "ascending",
        descending: "descending",
    };
    return aliases[normalized];
}

function validateCharacter(id, data) {
    if (!data || typeof data !== "object") {
        throw new Error(`Карточка ${id}.yaml пуста или повреждена.`);
    }

    if (!data.name || !Array.isArray(data.tags) || !data.description) {
        throw new Error(`В карточке ${id}.yaml обязательны name, tags и description.`);
    }

    const relations = Array.isArray(data.relations) ? data.relations : [];
    const characterData = data.data && typeof data.data === "object"
        && !Array.isArray(data.data)
        ? data.data
        : {};

    for (const key of Object.keys(characterData)) {
        if (!/^[a-z][a-z0-9_-]*$/.test(key)) {
            throw new Error(
                `В карточке ${id}.yaml ключ data.${key} должен быть на английском.`
            );
        }
    }

    relations.forEach((relation, index) => {
        const relationClass = String(relation.class || "").toLocaleLowerCase("en");
        if (
            !relation.character
            || !relation.name
            || !normalizeRelationType(relation.type)
            || !allowedRelationClasses.has(relationClass)
        ) {
            throw new Error(
                `Некорректная связь ${index + 1} в ${id}.yaml. `
                + "Нужны character, name, type: asc/desc и допустимый class."
            );
        }
    });

    return {
        id,
        kind: "character",
        name: String(data.name),
        portrait: data.portrait ? String(data.portrait) : null,
        art: data.art ? String(data.art) : null,
        tags: data.tags.map(String),
        description: String(data.description),
        data: characterData,
        relations: relations.map((relation) => ({
            character: String(relation.character),
            name: String(relation.name),
            type: normalizeRelationType(relation.type),
            class: String(relation.class).toLocaleLowerCase("en"),
        })),
    };
}

function validateDataKey(id, data) {
    if (!data || typeof data !== "object" || !data.name) {
        throw new Error(`В ключе ${id}.yaml обязательно поле name.`);
    }

    if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
        throw new Error(`ID ключа ${id} должен быть на английском.`);
    }

    return {
        id,
        name: String(data.name),
    };
}

function validateTag(id, data) {
    if (!data || typeof data !== "object" || !data.name || !data.description) {
        throw new Error(`В теге ${id}.yaml обязательны поля name и description.`);
    }

    return {
        id,
        nodeId: `tag:${id}`,
        kind: "tag",
        name: String(data.name),
        description: String(data.description),
        tags: [],
    };
}

function validateGraphMode(id, data) {
    if (!data || typeof data !== "object" || !data.name || !data.description) {
        throw new Error(`В режиме ${id}.yaml обязательны поля name и description.`);
    }

    const filters = data.filters && typeof data.filters === "object"
        ? data.filters
        : {};
    const tags = Array.isArray(filters.tags) ? filters.tags.map(String) : [];
    const match = filters.match || "any";
    const relationSettings = data.relations && typeof data.relations === "object"
        ? data.relations
        : {};
    const excludeClasses = Array.isArray(relationSettings.exclude_classes)
        ? relationSettings.exclude_classes.map((value) =>
            String(value).toLocaleLowerCase("en")
        )
        : [];
    const tagNodes = Array.isArray(data.tag_nodes)
        ? data.tag_nodes.map(String)
        : [];
    const nodeData = Array.isArray(data.node_data)
        ? data.node_data.map(String)
        : [];
    const captions = Array.isArray(data.captions)
        ? data.captions.map((caption, index) => {
            if (!caption?.character || !caption?.text) {
                throw new Error(
                    `Некорректный caption ${index + 1} в режиме ${id}.yaml. `
                    + "Нужны character и text."
                );
            }

            return {
                character: String(caption.character),
                text: String(caption.text),
            };
        })
        : [];

    if (!["any", "all"].includes(match)) {
        throw new Error(`В режиме ${id}.yaml filters.match должен быть any или all.`);
    }

    const invalidClass = excludeClasses.find((value) => !allowedRelationClasses.has(value));
    if (invalidClass) {
        throw new Error(`В режиме ${id}.yaml указан неизвестный класс связи: ${invalidClass}.`);
    }

    return {
        id,
        name: String(data.name),
        description: String(data.description),
        filters: { tags, match },
        relations: { excludeClasses },
        tagNodes,
        captions,
        nodeData,
    };
}

function buildLinks(nodes, excludedClasses = new Set()) {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const byPair = new Map();

    for (const node of nodes) {
        for (const relation of node.relations) {
            if (excludedClasses.has(relation.class)) {
                continue;
            }

            if (!nodeIds.has(relation.character)) {
                console.warn(`Связь ${node.id} → ${relation.character} указывает на отсутствующую карточку.`);
                continue;
            }

            const source = relation.type === "descending"
                ? node.id
                : relation.character;
            const target = relation.type === "descending"
                ? relation.character
                : node.id;
            const pair = [node.id, relation.character].sort();
            const key = `${pair[0]}\u0000${pair[1]}\u0000${relation.class}`;

            if (!byPair.has(key)) {
                byPair.set(key, {
                    source,
                    target,
                    class: relation.class,
                    labels: [],
                    declaredBy: new Set(),
                });
            }

            const link = byPair.get(key);
            link.declaredBy.add(node.id);
            if (!link.labels.includes(relation.name)) {
                link.labels.push(relation.name);
            }
        }
    }

    return Array.from(byPair.values()).map((link, index) => {
        const bidirectional = link.declaredBy.size > 1;
        return {
            source: link.source,
            target: link.target,
            class: link.class,
            id: `link-${index}`,
            label: link.labels.join(" · "),
            directed: !bidirectional,
        };
    });
}

function buildTagLinks(visibleCharacters, tagNodes) {
    return tagNodes.flatMap((tag) => {
        return visibleCharacters
            .filter((character) => character.tags.includes(tag.id))
            .map((character) => ({
                source: tag.nodeId,
                target: character.id,
                class: "tag",
                id: `tag-link-${tag.id}-${character.id}`,
                label: "",
                directed: false,
            }));
    });
}

function populateGraphModes(modes) {
    const options = modes.map((mode) => {
        const option = document.createElement("option");
        option.value = mode.id;
        option.textContent = mode.name;
        return option;
    });

    graphModeSelect.replaceChildren(...options);
    graphModeMenu.replaceChildren(...modes.map((mode) => {
        const button = document.createElement("button");
        button.className = "view-filter-option";
        button.type = "button";
        button.role = "option";
        button.dataset.mode = mode.id;
        button.setAttribute("aria-selected", "false");
        button.innerHTML = `
            <span class="view-filter-option-mark">✓</span>
            <span>${escapeHtml(mode.name)}</span>
        `;
        button.addEventListener("click", () => {
            applyGraphMode(mode.id);
            closeGraphModeMenu();
            graphModeButton.focus();
        });
        return button;
    }));
}

function openGraphModeMenu() {
    graphModeMenu.hidden = false;
    graphModeButton.setAttribute("aria-expanded", "true");
    graphModeMenu.querySelector('[aria-selected="true"]')?.focus();
}

function closeGraphModeMenu() {
    graphModeMenu.hidden = true;
    graphModeButton.setAttribute("aria-expanded", "false");
}

function updateGraphModeControl(mode) {
    graphModeLabel.textContent = mode.name;
    graphModeLabel.title = mode.name;
    graphModeMenu.querySelectorAll("[data-mode]").forEach((option) => {
        option.setAttribute("aria-selected", String(option.dataset.mode === mode.id));
    });
}

function characterMatchesMode(character, mode) {
    const tags = mode.filters.tags;
    if (!tags.length) {
        return true;
    }

    return mode.filters.match === "all"
        ? tags.every((tag) => character.tags.includes(tag))
        : tags.some((tag) => character.tags.includes(tag));
}

function applyGraphMode(modeId, animate = true) {
    const mode = graphModes.find((item) => item.id === modeId) || graphModes[0];
    if (!mode) {
        return;
    }

    graphModeSelect.value = mode.id;
    updateGraphModeControl(mode);
    graphModeDescription.textContent = mode.description;
    const captions = new Map(
        mode.captions.map((caption) => [caption.character, caption.text])
    );
    characters = allCharacters
        .filter((character) => characterMatchesMode(character, mode))
        .map((character) => ({
            ...character,
            caption: captions.get(character.id) || null,
            nodeData: mode.nodeData
                .filter((keyId) => character.data[keyId] !== undefined)
                .map((keyId) => ({
                    key: keyId,
                    value: character.data[keyId],
                })),
        }));
    const visibleTagNodes = mode.tagNodes
        .map((tagId) => allTags.find((tag) => tag.id === tagId))
        .filter(Boolean)
        .map((tag) => ({ ...tag, id: tag.nodeId }));
    nodes = [...characters, ...visibleTagNodes];
    excludedRelationClasses = new Set(mode.relations.excludeClasses);
    links = [
        ...buildLinks(characters, excludedRelationClasses),
        ...buildTagLinks(characters, allTags.filter((tag) => mode.tagNodes.includes(tag.id))),
    ];

    if (selectedId && !nodes.some((node) => node.id === selectedId)) {
        selectedId = null;
        renderEmptyDossier();
    }

    if (simulation) {
        simulation.stop();
    }

    renderGraph();
    updateHighlight();

    requestAnimationFrame(() => fitGraph(animate));
}

function renderDossier(character) {
    selectedId = character.id;

    const visibleRelations = character.relations.filter((relation) => {
        return !excludedRelationClasses.has(relation.class)
            && characters.some((item) => item.id === relation.character);
    });
    const relationItems = visibleRelations.map((relation) => {
        const target = characters.find((item) => item.id === relation.character);
        const arrow = relation.type === "descending" ? "→" : "←";
        const direction = relation.type === "descending"
            ? "Стрелка от персонажа"
            : "Стрелка к персонажу";

        return `
            <li>
                <button class="relation-button" type="button" data-character="${relation.character}">
                    <span class="relation-arrow" title="${direction}">${arrow}</span>
                    <span>
                        <span class="relation-name">${escapeHtml(relation.name)}</span>
                        <span class="relation-target">${escapeHtml(target?.name || relation.character)}</span>
                    </span>
                </button>
            </li>
        `;
    }).join("");

    const portrait = character.portrait
        ? `<div class="portrait">
            <span class="portrait-fallback">${escapeHtml(initials(character.name))}</span>
            <img src="${escapeHtml(portraitUrl(character.portrait))}" alt="">
        </div>`
        : `<div class="portrait">${escapeHtml(initials(character.name))}</div>`;

    dossier.innerHTML = `
        ${portrait}
        <h2>${escapeHtml(character.name)}</h2>
        ${character.caption
            ? `<p class="character-caption">${escapeHtml(character.caption)}</p>`
            : ""}
        <div class="tags">
            ${character.tags.map((tagId) => {
                const tag = allTags.find((item) => item.id === tagId);
                return `<button class="tag" type="button" data-tag="${escapeHtml(tagId)}">
                    ${escapeHtml(tag?.name || tagId)}
                </button>`;
            }).join("")}
        </div>
        ${renderDescription(character.description)}
        ${renderCharacterData(character)}
        ${relationItems
            ? `<section class="dossier-section">
                <ul class="relation-list">${relationItems}</ul>
            </section>`
            : ""}
    `;

    dossier.querySelectorAll("[data-character]").forEach((button) => {
        button.addEventListener("click", () => {
            selectCharacter(button.dataset.character, true);
        });
    });
    dossier.querySelectorAll("[data-tag]").forEach((button) => {
        button.addEventListener("click", () => {
            openTagModal(button.dataset.tag);
        });
    });
    dossier.querySelector(".portrait img")?.addEventListener("error", (event) => {
        event.currentTarget.remove();
    });
    dossier.querySelector(".portrait img")?.addEventListener("click", () => {
        openPortraitModal(character);
    });

    updateHighlight();
}

function renderTagDossier(tagNode) {
    selectedId = tagNode.id;
    const taggedCharacters = characters.filter((character) =>
        character.tags.includes(tagNode.tagId || tagNode.id.replace(/^tag:/, ""))
    );

    dossier.innerHTML = `
        <div class="portrait portrait-tag">#</div>
        <h2>${escapeHtml(tagNode.name)}</h2>
        <p>${escapeHtml(tagNode.description)}</p>
        ${taggedCharacters.length
            ? `<section class="dossier-section">
                <ul class="relation-list">
                    ${taggedCharacters.map((character) => `
                        <li>
                            <button class="relation-button" type="button" data-character="${character.id}">
                                <span class="relation-arrow">·</span>
                                <span class="relation-target">${escapeHtml(character.name)}</span>
                            </button>
                        </li>
                    `).join("")}
                </ul>
            </section>`
            : ""}
    `;

    dossier.querySelectorAll("[data-character]").forEach((button) => {
        button.addEventListener("click", () => {
            selectCharacter(button.dataset.character, true);
        });
    });

    updateHighlight();
}

function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = String(value);
    return element.innerHTML;
}

function renderDataValue(value) {
    if (Array.isArray(value)) {
        return `<ul class="character-data-list">
            ${value.map((item) => `<li>${renderDataValue(item)}</li>`).join("")}
        </ul>`;
    }

    if (value && typeof value === "object") {
        return `<dl class="character-data-nested">
            ${Object.entries(value).map(([key, nestedValue]) => `
                <div>
                    <dt>${escapeHtml(key)}</dt>
                    <dd>${renderDataValue(nestedValue)}</dd>
                </div>
            `).join("")}
        </dl>`;
    }

    if (typeof value === "boolean") {
        return value ? "Да" : "Нет";
    }

    if (value === null || value === undefined) {
        return "—";
    }

    return escapeHtml(value);
}

function renderCharacterData(character) {
    const entries = Object.entries(character.data || {});
    if (!entries.length) {
        return "";
    }

    return `
        <dl class="character-data">
            ${entries.map(([key, value]) => {
                const keyDefinition = allKeys.find((item) => item.id === key);
                return `
                    <div class="character-data-row">
                        <dt>${escapeHtml(keyDefinition?.name || key)}</dt>
                        <dd>${renderDataValue(value)}</dd>
                    </div>
                `;
            }).join("")}
        </dl>
    `;
}

function renderDescription(description) {
    const paragraphs = String(description)
        .split(/\r?\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return `
        <div class="character-description">
            ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </div>
    `;
}

function selectCharacter(id, center = false) {
    const character = characters.find((item) => item.id === id);
    if (!character) {
        return;
    }

    renderDossier(character);

    if (center && Number.isFinite(character.x) && Number.isFinite(character.y)) {
        const bounds = stage.getBoundingClientRect();
        const transform = d3.zoomIdentity
            .translate(bounds.width / 2, bounds.height / 2)
            .scale(1.15)
            .translate(-character.x, -character.y);

        svg.transition().duration(550).call(zoom.transform, transform);
    }
}

function selectNode(id, center = false) {
    const node = nodes.find((item) => item.id === id);
    if (!node) {
        return;
    }

    if (node.kind === "tag") {
        renderTagDossier(node);
    } else {
        renderDossier(node);
    }

    if (center && Number.isFinite(node.x) && Number.isFinite(node.y)) {
        const bounds = stage.getBoundingClientRect();
        const transform = d3.zoomIdentity
            .translate(bounds.width / 2, bounds.height / 2)
            .scale(1.15)
            .translate(-node.x, -node.y);

        svg.transition().duration(550).call(zoom.transform, transform);
    }
}

function currentMatches() {
    const query = searchInput.value.trim().toLocaleLowerCase("ru");

    return new Set(nodes
        .filter((node) => {
            const searchable = [
                node.id,
                node.name,
                node.description,
                ...node.tags,
            ].join(" ").toLocaleLowerCase("ru");

            return !query || searchable.includes(query);
        })
        .map((node) => node.id));
}

function updateHighlight() {
    if (!nodeSelection) {
        return;
    }

    const matches = currentMatches();
    const hasFilter = Boolean(searchInput.value.trim());
    if (hasFilter && selectedId && !matches.has(selectedId)) {
        selectedId = null;
        renderEmptyDossier();
    }

    const neighbors = new Set();

    if (selectedId) {
        neighbors.add(selectedId);
        links.forEach((link) => {
            const sourceId = typeof link.source === "object" ? link.source.id : link.source;
            const targetId = typeof link.target === "object" ? link.target.id : link.target;
            if (sourceId === selectedId) neighbors.add(targetId);
            if (targetId === selectedId) neighbors.add(sourceId);
        });
    }

    nodeSelection
        .classed("is-selected", (node) => node.id === selectedId)
        .classed("is-muted", (node) => {
            if (hasFilter && !matches.has(node.id)) return true;
            return selectedId ? !neighbors.has(node.id) : false;
        });

    linkSelection.classed("is-muted", (link) => {
        const sourceId = link.source.id;
        const targetId = link.target.id;
        if (hasFilter && (!matches.has(sourceId) || !matches.has(targetId))) return true;
        return selectedId ? sourceId !== selectedId && targetId !== selectedId : false;
    });

    linkLabelSelection.classed("is-muted", (link) => {
        const sourceId = link.source.id;
        const targetId = link.target.id;
        if (hasFilter && (!matches.has(sourceId) || !matches.has(targetId))) return true;
        return selectedId ? sourceId !== selectedId && targetId !== selectedId : false;
    });

    counterElement.textContent = hasFilter
        ? `${matches.size} из ${characters.length} персонажей`
        : `${characters.length} персонажей · ${links.length} связей`;
}

function dragBehavior(simulationInstance) {
    return d3.drag()
        .on("start", (event, node) => {
            event.sourceEvent?.currentTarget?.focus();
            selectNode(node.id);
            if (!event.active) simulationInstance.alphaTarget(0.22).restart();
            node.fx = node.x;
            node.fy = node.y;
        })
        .on("drag", (event, node) => {
            node.fx = event.x;
            node.fy = event.y;
        })
        .on("end", (event, node) => {
            if (!event.active) simulationInstance.alphaTarget(0);
            node.fx = null;
            node.fy = null;
        });
}

function fitGraph(animate = true) {
    if (!graphRoot || !nodes.length) {
        return;
    }

    const bounds = graphRoot.node().getBBox();
    const viewport = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height || !viewport.width || !viewport.height) {
        return;
    }

    const scale = Math.min(
        1.4,
        0.84 / Math.max(bounds.width / viewport.width, bounds.height / viewport.height)
    );
    const translateX = viewport.width / 2 - scale * (bounds.x + bounds.width / 2);
    const translateY = viewport.height / 2 - scale * (bounds.y + bounds.height / 2);
    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    const target = animate ? svg.transition().duration(600) : svg;
    target.call(zoom.transform, transform);
}

function nodeCollisionRadius(node) {
    if (node.kind === "tag") return 54;
    if (node.caption && node.nodeData?.length) return 112;
    if (node.caption || node.nodeData?.length) return 102;
    return 92;
}

function pointToSegmentDistance(node, source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) {
        return Math.hypot(node.x - source.x, node.y - source.y);
    }

    const ratio = Math.max(0, Math.min(1,
        ((node.x - source.x) * dx + (node.y - source.y) * dy) / lengthSquared
    ));
    const closestX = source.x + ratio * dx;
    const closestY = source.y + ratio * dy;
    return Math.hypot(node.x - closestX, node.y - closestY);
}

function forceLinkClearance(graphLinks) {
    let graphNodes = [];

    function force(alpha) {
        for (const node of graphNodes) {
            const clearance = node.kind === "tag" ? 34 : 58;

            for (const link of graphLinks) {
                if (link.source === node || link.target === node) {
                    continue;
                }

                const source = link.source;
                const target = link.target;
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const lengthSquared = dx * dx + dy * dy;
                if (!lengthSquared) {
                    continue;
                }

                const ratio = Math.max(0.08, Math.min(0.92,
                    ((node.x - source.x) * dx + (node.y - source.y) * dy)
                    / lengthSquared
                ));
                const closestX = source.x + ratio * dx;
                const closestY = source.y + ratio * dy;
                let offsetX = node.x - closestX;
                let offsetY = node.y - closestY;
                let distance = Math.hypot(offsetX, offsetY);

                if (distance >= clearance) {
                    continue;
                }

                if (distance < 0.001) {
                    offsetX = -dy;
                    offsetY = dx;
                    distance = Math.hypot(offsetX, offsetY) || 1;
                }

                const push = (clearance - distance) / clearance * alpha * 14;
                node.vx += offsetX / distance * push;
                node.vy += offsetY / distance * push;
            }
        }
    }

    force.initialize = (initializedNodes) => {
        graphNodes = initializedNodes;
    };

    return force;
}

function createGraphSimulation(simulationNodes, simulationLinks, randomSource) {
    return d3.forceSimulation(simulationNodes)
        .randomSource(randomSource)
        .force("link", d3.forceLink(simulationLinks)
            .id((node) => node.id)
            .distance((link) => link.class === "tag" ? 160 : 320)
            .strength(0.72))
        .force("charge", d3.forceManyBody()
            .strength((node) => node.kind === "tag" ? -340 : -760))
        .force("center", d3.forceCenter(0, 0))
        .force("collision", d3.forceCollide()
            .radius(nodeCollisionRadius)
            .strength(0.9))
        .force("x", d3.forceX(0).strength(0.045))
        .force("y", d3.forceY(0).strength(0.045))
        .force("link-clearance", forceLinkClearance(simulationLinks));
}

function segmentsCross(first, second) {
    const a = first.source;
    const b = first.target;
    const c = second.source;
    const d = second.target;

    if (a.id === c.id || a.id === d.id || b.id === c.id || b.id === d.id) {
        return false;
    }

    const cross = (p1, p2, p3) =>
        (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);

    return abC * abD < 0 && cdA * cdB < 0;
}

function scoreLayout(candidateNodes, candidateLinks) {
    let score = 0;

    for (let first = 0; first < candidateLinks.length; first += 1) {
        for (let second = first + 1; second < candidateLinks.length; second += 1) {
            if (segmentsCross(candidateLinks[first], candidateLinks[second])) {
                score += 18000;
            }
        }
    }

    for (const node of candidateNodes) {
        for (const link of candidateLinks) {
            if (link.source === node || link.target === node) {
                continue;
            }

            const clearance = node.kind === "tag" ? 34 : 58;
            const distance = pointToSegmentDistance(node, link.source, link.target);
            if (distance < clearance) {
                score += (clearance - distance) ** 2 * 18;
            }
        }
    }

    return score;
}

function calculateBestLayout() {
    let bestLayout = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const random = d3.randomLcg(0.137 + attempt * 0.149);
        const candidateNodes = nodes.map((node) => ({
            ...node,
            x: (random() - 0.5) * 1000,
            y: (random() - 0.5) * 760,
            vx: 0,
            vy: 0,
        }));
        const candidateLinks = links.map((link) => ({
            ...link,
            source: typeof link.source === "object" ? link.source.id : link.source,
            target: typeof link.target === "object" ? link.target.id : link.target,
        }));
        const candidateSimulation = createGraphSimulation(
            candidateNodes,
            candidateLinks,
            random
        ).stop();

        for (let index = 0; index < 380; index += 1) {
            candidateSimulation.tick();
        }

        const candidateScore = scoreLayout(candidateNodes, candidateLinks);
        if (candidateScore < bestScore) {
            bestScore = candidateScore;
            bestLayout = new Map(candidateNodes.map((node) => [
                node.id,
                { x: node.x, y: node.y },
            ]));
        }
    }

    for (const node of nodes) {
        const position = bestLayout?.get(node.id);
        if (position) {
            node.x = position.x;
            node.y = position.y;
            node.vx = 0;
            node.vy = 0;
        }
    }
}

function renderGraph() {
    svg.selectAll("*").remove();

    const defs = svg.append("defs");
    defs.append("marker")
        .attr("id", "arrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 31)
        .attr("refY", 0)
        .attr("markerWidth", 7)
        .attr("markerHeight", 7)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#858d87");

    graphRoot = svg.append("g");
    const linkLayer = graphRoot.append("g");
    const labelLayer = graphRoot.append("g");
    const nodeLayer = graphRoot.append("g");

    zoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .on("zoom", (event) => graphRoot.attr("transform", event.transform));
    svg.call(zoom);

    linkSelection = linkLayer
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("class", (link) => `link link-${link.class}`)
        .attr("marker-end", (link) => link.directed ? "url(#arrow)" : null);

    linkLabelSelection = labelLayer
        .selectAll("text")
        .data(links)
        .join("text")
        .attr("class", "link-label")
        .text((link) => link.label);

    nodeSelection = nodeLayer
        .selectAll("g")
        .data(nodes)
        .join("g")
        .attr("class", (node) => `node node-${node.kind}`)
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (node) => `Открыть карточку: ${node.name}`)
        .on("click", (event, node) => {
            event.stopPropagation();
            event.currentTarget.focus();
            selectNode(node.id);
        })
        .on("keydown", (event, node) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectNode(node.id, true);
            }
        });

    nodeSelection.append("rect")
        .attr("class", "focus-frame")
        .attr("rx", 5);

    nodeSelection.append("circle")
        .attr("class", "halo")
        .attr("r", (node) => node.kind === "tag" ? 20 : 28);

    nodeSelection.append("circle")
        .attr("class", "disc")
        .attr("r", (node) => node.kind === "tag" ? 15 : 23)
        .attr("stroke", (node) => node.kind === "tag"
            ? "#9da69f"
            : color(node.tags[0] || "Без тега"));

    nodeSelection.append("text")
        .attr("class", "initials")
        .attr("dy", "0.36em")
        .text((node) => node.kind === "tag" ? "#" : initials(node.name));

    nodeSelection
        .filter((node) => node.kind === "character" && node.portrait)
        .append("image")
        .attr("class", "node-portrait")
        .attr("href", (node) => portraitUrl(node.portrait))
        .attr("x", -21)
        .attr("y", -21)
        .attr("width", 42)
        .attr("height", 42)
        .attr("preserveAspectRatio", "xMidYMid slice")
        .on("error", function () {
            d3.select(this).remove();
        });

    nodeSelection.append("text")
        .attr("class", "node-name")
        .attr("y", (node) => node.kind === "tag" ? 29 : 39)
        .text((node) => node.name);

    nodeSelection
        .filter((node) => node.kind === "character" && node.caption)
        .append("text")
        .attr("class", "node-caption")
        .attr("y", 55)
        .text((node) => node.caption);

    nodeSelection
        .filter((node) => node.kind === "character" && node.nodeData?.length)
        .append("text")
        .attr("class", "node-data")
        .attr("y", (node) => node.caption ? 69 : 55)
        .text((node) => node.nodeData.map(({ value }) => {
            return Array.isArray(value) ? value.join(", ") : String(value);
        }).join(" · "));

    nodeSelection.each(function () {
        const content = this.querySelectorAll(
            ".disc, .node-name, .node-caption, .node-data"
        );
        const bounds = Array.from(content).reduce((result, element) => {
            const box = element.getBBox();
            return {
                left: Math.min(result.left, box.x),
                top: Math.min(result.top, box.y),
                right: Math.max(result.right, box.x + box.width),
                bottom: Math.max(result.bottom, box.y + box.height),
            };
        }, {
            left: Number.POSITIVE_INFINITY,
            top: Number.POSITIVE_INFINITY,
            right: Number.NEGATIVE_INFINITY,
            bottom: Number.NEGATIVE_INFINITY,
        });
        const horizontalPadding = 10;
        const verticalPadding = 9;

        d3.select(this).select(".focus-frame")
            .attr("x", bounds.left - horizontalPadding)
            .attr("y", bounds.top - verticalPadding)
            .attr("width", bounds.right - bounds.left + horizontalPadding * 2)
            .attr("height", bounds.bottom - bounds.top + verticalPadding * 2);
    });

    const updatePositions = () => {
        linkSelection
            .attr("x1", (link) => link.source.x)
            .attr("y1", (link) => link.source.y)
            .attr("x2", (link) => link.target.x)
            .attr("y2", (link) => link.target.y);

        linkLabelSelection
            .attr("x", (link) => (link.source.x + link.target.x) / 2)
            .attr("y", (link) => (link.source.y + link.target.y) / 2 - 6);

        nodeSelection.attr("transform", (node) => `translate(${node.x},${node.y})`);
    };

    calculateBestLayout();
    simulation = createGraphSimulation(
        nodes,
        links,
        d3.randomLcg(0.731)
    ).on("tick", updatePositions);
    simulation.alpha(0.08).stop();
    updatePositions();

    nodeSelection.call(dragBehavior(simulation));
    svg.on("click", (event) => {
        if (event.target === svg.node()) {
            clearSelection();
        }
    });

}

async function loadYaml(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Не удалось загрузить ${url} (${response.status}).`);
    }
    return jsyaml.load(await response.text());
}

async function loadIndexedYamlCollection(baseUrl, ids, collectionName, validator) {
    if (!Array.isArray(ids)) {
        throw new Error(`В data/_index.yaml должен быть массив ${collectionName}.`);
    }

    return Promise.all(ids.map(async (id) => {
        const normalizedId = String(id).replace(/\.ya?ml$/i, "");
        const data = await loadYaml(`${baseUrl}${normalizedId}.yaml`);
        return validator(normalizedId, data);
    }));
}

async function loadData() {
    try {
        const dataIndex = await loadYaml(`${dataRoot}_index.yaml`);
        [allCharacters, allTags, allKeys, graphModes] = await Promise.all([
            loadIndexedYamlCollection(
                charactersDataBase,
                dataIndex?.characters,
                "characters",
                validateCharacter
            ),
            loadIndexedYamlCollection(
                tagsDataBase,
                dataIndex?.tags,
                "tags",
                validateTag
            ),
            loadIndexedYamlCollection(
                keysDataBase,
                dataIndex?.keys,
                "keys",
                validateDataKey
            ),
            loadIndexedYamlCollection(
                graphsDataBase,
                dataIndex?.graphs,
                "graphs",
                validateGraphMode
            ),
        ]);

        if (!graphModes.length) {
            throw new Error("Не найдено ни одного режима просмотра.");
        }

        const knownTagIds = new Set(allTags.map((tag) => tag.id));
        const knownKeyIds = new Set(allKeys.map((key) => key.id));
        for (const character of allCharacters) {
            const unknownTag = character.tags.find((tagId) => !knownTagIds.has(tagId));
            if (unknownTag) {
                throw new Error(`У персонажа ${character.id} указан неизвестный тег: ${unknownTag}.`);
            }

            const unknownKey = Object.keys(character.data).find(
                (keyId) => !knownKeyIds.has(keyId)
            );
            if (unknownKey) {
                throw new Error(
                    `У персонажа ${character.id} указан неизвестный ключ data: ${unknownKey}.`
                );
            }
        }
        for (const mode of graphModes) {
            const unknownFilterTag = mode.filters.tags.find((tagId) => !knownTagIds.has(tagId));
            const unknownNodeTag = mode.tagNodes.find((tagId) => !knownTagIds.has(tagId));
            if (unknownFilterTag || unknownNodeTag) {
                throw new Error(
                    `В режиме ${mode.id} указан неизвестный тег: ${unknownFilterTag || unknownNodeTag}.`
                );
            }

            const unknownNodeDataKey = mode.nodeData.find(
                (keyId) => !knownKeyIds.has(keyId)
            );
            if (unknownNodeDataKey) {
                throw new Error(
                    `В режиме ${mode.id} node_data ссылается на неизвестный ключ: `
                    + `${unknownNodeDataKey}.`
                );
            }

            const knownCharacterIds = new Set(allCharacters.map((character) => character.id));
            const unknownCaptionCharacter = mode.captions.find(
                (caption) => !knownCharacterIds.has(caption.character)
            );
            if (unknownCaptionCharacter) {
                throw new Error(
                    `В режиме ${mode.id} caption ссылается на неизвестного персонажа: `
                    + `${unknownCaptionCharacter.character}.`
                );
            }
        }

        populateGraphModes(graphModes);
        applyGraphMode(graphModes[0].id, false);
        statusElement.hidden = true;
    } catch (error) {
        console.error(error);
        statusElement.classList.add("is-error");
        statusElement.textContent = location.protocol === "file:"
            ? "Не удалось загрузить картотеку. Запустите локальный HTTP-сервер или откройте опубликованную страницу GitHub Pages."
            : `Не удалось загрузить картотеку: ${error.message}`;
        counterElement.textContent = "Ошибка загрузки";
    }
}

searchInput.addEventListener("input", updateHighlight);
graphModeSelect.addEventListener("change", () => {
    applyGraphMode(graphModeSelect.value);
});
graphModeButton.addEventListener("click", () => {
    if (graphModeMenu.hidden) {
        openGraphModeMenu();
    } else {
        closeGraphModeMenu();
    }
});
graphModeButton.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGraphModeMenu();
    }
});
graphModeMenu.addEventListener("keydown", (event) => {
    const options = Array.from(graphModeMenu.querySelectorAll("[data-mode]"));
    const currentIndex = options.indexOf(document.activeElement);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (currentIndex + direction + options.length) % options.length;
        options[nextIndex].focus();
    } else if (event.key === "Escape") {
        closeGraphModeMenu();
        graphModeButton.focus();
    }
});
document.addEventListener("click", (event) => {
    if (!event.target.closest(".view-filter")) {
        closeGraphModeMenu();
    }
});
document.getElementById("zoom-in").addEventListener("click", () => {
    svg.transition().duration(220).call(zoom.scaleBy, 1.3);
});
document.getElementById("zoom-out").addEventListener("click", () => {
    svg.transition().duration(220).call(zoom.scaleBy, 1 / 1.3);
});
document.getElementById("zoom-reset").addEventListener("click", () => fitGraph());
window.addEventListener("resize", () => fitGraph(false));
portraitModalClose.addEventListener("click", closePortraitModal);
portraitModal.addEventListener("click", (event) => {
    if (event.target === portraitModal) {
        closePortraitModal();
    }
});
portraitModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closePortraitModal();
});
portraitModalImage.addEventListener("click", closePortraitModal);
portraitModalImage.addEventListener("error", () => {
    const fallback = portraitModalImage.dataset.fallback;
    if (!fallback || portraitModalImage.src.endsWith(fallback)) {
        return;
    }

    delete portraitModalImage.dataset.fallback;
    portraitModalImage.src = fallback;
});
tagModalClose.addEventListener("click", closeTagModal);
tagModal.addEventListener("click", (event) => {
    if (event.target === tagModal) {
        closeTagModal();
    }
});
tagModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeTagModal();
});

loadData();
