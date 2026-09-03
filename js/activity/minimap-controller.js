// Copyright (c) 2026 Sugarlabs
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the The GNU Affero General Public
// License as published by the Free Software Foundation; either
// version 3 of the License, or (at your option) any later version.
//
// You should have received a copy of the GNU Affero General Public
// License along with this library; if not, write to the Free Software
// Foundation, 51 Franklin Street, Suite 500 Boston, MA 02110-1335 USA

/* global _ */

/* exported setupMinimapController, MinimapController */

/**
 * Palette family color mapping for mini-map block representation.
 */
const PALETTE_COLORS = {
    action: "#ab47bc",
    number: "#0288d1",
    flow: "#43a047",
    pitch: "#fb8c00",
    drum: "#8d6e63",
    rhythm: "#3949ab",
    sound: "#e53935",
    pen: "#00897b",
    status: "#546e7a",
    default: "#78909c"
};

/**
 * MinimapController provides a live bird's-eye radar view of the canvas,
 * displaying active block stacks, the current camera viewport viewfinder,
 * and enabling smooth one-click panning and non-destructive fit-all centering.
 */
class MinimapController {
    /**
     * @param {object} activity - The Activity instance.
     */
    constructor(activity) {
        this.activity = activity;
        this.isExpanded = false;

        this.canvasWidth = 210;
        this.canvasHeight = 135;

        // Visual mapping transform metrics
        this.viewScale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.worldMinX = 0;
        this.worldMinY = 0;

        // Viewfinder tracking state
        this.viewfinder = { x: 0, y: 0, w: 0, h: 0 };
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this._updateScheduled = false;

        // DOM element references
        this.container = null;
        this.pillBtn = null;
        this.card = null;
        this.canvas = null;
        this.ctx = null;
        this.emptyHint = null;

        // Bound event listeners for clean disposal
        this._handleGlobalPointerMove = this._onPointerMove.bind(this);
        this._handleGlobalPointerUp = this._onPointerUp.bind(this);
    }

    /**
     * Initializes the DOM elements, binds event listeners, and schedules first draw.
     * @returns {void}
     */
    init() {
        if (this.container || typeof document === "undefined") {
            return;
        }

        const parent = document.getElementById("canvasHolder") || document.body;

        this.container = document.createElement("div");
        this.container.id = "minimap-container";

        // 1. Collapsed Pill Toggle Button
        this.pillBtn = document.createElement("button");
        this.pillBtn.className = "minimap-pill-btn";
        this.pillBtn.style.display = "flex";
        this.pillBtn.type = "button";
        this.pillBtn.setAttribute("aria-label", _("Toggle Canvas Navigator"));
        this.pillBtn.innerHTML =
            '<span class="minimap-pill-icon" aria-hidden="true">🗺️</span>' +
            `<span>${_("Navigator")}</span>`;
        this.pillBtn.addEventListener("click", () => this.toggle(true));

        // 2. Expanded Navigator Card
        this.card = document.createElement("div");
        this.card.className = "minimap-card";
        this.card.style.display = "none";

        // Header toolbar
        const header = document.createElement("div");
        header.className = "minimap-header";

        const title = document.createElement("span");
        title.className = "minimap-title";
        title.textContent = _("Navigator");

        const controls = document.createElement("div");
        controls.className = "minimap-controls";

        // Fit All button
        const fitBtn = document.createElement("button");
        fitBtn.className = "minimap-action-btn";
        fitBtn.type = "button";
        fitBtn.title = _("Fit All Blocks in View");
        fitBtn.setAttribute("aria-label", _("Fit All Blocks in View"));
        fitBtn.innerHTML = "⛶";
        fitBtn.addEventListener("click", e => {
            e.stopPropagation();
            this.fitAll();
        });

        // Close / Minimize button
        const closeBtn = document.createElement("button");
        closeBtn.className = "minimap-action-btn";
        closeBtn.type = "button";
        closeBtn.title = _("Minimize Navigator");
        closeBtn.setAttribute("aria-label", _("Minimize Navigator"));
        closeBtn.innerHTML = "✕";
        closeBtn.addEventListener("click", e => {
            e.stopPropagation();
            this.toggle(false);
        });

        controls.appendChild(fitBtn);
        controls.appendChild(closeBtn);
        header.appendChild(title);
        header.appendChild(controls);

        // Canvas container
        const canvasWrapper = document.createElement("div");
        canvasWrapper.className = "minimap-canvas-wrapper";

        this.canvas = document.createElement("canvas");
        this.canvas.className = "minimap-canvas";
        // Retina sharpness: 2x backing buffer scaled down via CSS
        this.canvas.width = this.canvasWidth * 2;
        this.canvas.height = this.canvasHeight * 2;
        this.ctx = this.canvas.getContext("2d");

        this.emptyHint = document.createElement("div");
        this.emptyHint.className = "minimap-empty-hint";
        this.emptyHint.textContent = _("No blocks on canvas");
        this.emptyHint.style.display = "none";

        canvasWrapper.appendChild(this.canvas);
        canvasWrapper.appendChild(this.emptyHint);

        // Canvas interactive events
        this.canvas.addEventListener("pointerdown", this._onCanvasPointerDown.bind(this));

        this.card.appendChild(header);
        this.card.appendChild(canvasWrapper);

        this.container.appendChild(this.pillBtn);
        this.container.appendChild(this.card);
        parent.appendChild(this.container);

        window.addEventListener("pointermove", this._handleGlobalPointerMove);
        window.addEventListener("pointerup", this._handleGlobalPointerUp);

        // Restore saved preference if available
        try {
            const savedState = localStorage.getItem("musicblocks_minimap_open");
            if (savedState === "true") {
                this.toggle(true);
            }
        } catch (e) {
            // Ignore storage restrictions
        }
    }

    /**
     * Toggles between the expanded mini-map card and the collapsed badge button.
     * @param {boolean} [expand] - Force state if provided.
     */
    toggle(expand) {
        this.isExpanded = typeof expand === "boolean" ? expand : !this.isExpanded;

        if (this.pillBtn && this.card) {
            this.pillBtn.style.display = this.isExpanded ? "none" : "flex";
            this.card.style.display = this.isExpanded ? "flex" : "none";
        }

        try {
            localStorage.setItem("musicblocks_minimap_open", String(this.isExpanded));
        } catch (e) {
            // Ignore storage restrictions
        }

        if (this.isExpanded) {
            this.scheduleUpdate();
        }
    }

    /**
     * Debounces update calls via requestAnimationFrame to avoid O(N) canvas redraw on every mouse tick.
     */
    scheduleUpdate() {
        if (this._updateScheduled || !this.isExpanded) {
            return;
        }

        this._updateScheduled = true;
        requestAnimationFrame(() => {
            this._updateScheduled = false;
            this.draw();
        });
    }

    /**
     * Resolves the palette color for a block.
     * @param {object} block
     * @returns {string} Hex color
     */
    _getBlockColor(block) {
        if (block.protoblock && block.protoblock.palette && block.protoblock.palette.name) {
            const palette = block.protoblock.palette.name.toLowerCase();
            return PALETTE_COLORS[palette] || PALETTE_COLORS.default;
        }
        return PALETTE_COLORS.default;
    }

    /**
     * Calculates the bounding box of all active blocks and the visible viewport.
     * @returns {object} Bounding box metrics
     */
    getBounds() {
        const blocks = this.activity.blocks ? this.activity.blocks.blockList : [];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let activeCount = 0;

        for (const block of blocks) {
            if (!block || block.trash || !block.container) {
                continue;
            }

            activeCount++;
            const bx = block.container.x;
            const by = block.container.y;
            const bw = block.width || 60;
            const bh = block.height || 40;

            if (bx < minX) minX = bx;
            if (bx + bw > maxX) maxX = bx + bw;
            if (by < minY) minY = by;
            if (by + bh > maxY) maxY = by + bh;
        }

        // Current camera viewport in block coordinates
        const scale =
            typeof this.activity.getStageScale === "function"
                ? this.activity.getStageScale()
                : this.activity.turtleBlocksScale || 1;
        const screenW =
            this.activity.stage && this.activity.stage.canvas
                ? this.activity.stage.canvas.width / scale
                : window.innerWidth / scale;
        const screenH =
            this.activity.stage && this.activity.stage.canvas
                ? this.activity.stage.canvas.height / scale
                : window.innerHeight / scale;

        const containerX = this.activity.blocksContainer ? this.activity.blocksContainer.x : 0;
        const containerY = this.activity.blocksContainer ? this.activity.blocksContainer.y : 0;

        const vpX = -containerX === 0 ? 0 : -containerX;
        const vpY = -containerY === 0 ? 0 : -containerY;
        const vpR = vpX + screenW;
        const vpB = vpY + screenH;

        if (activeCount === 0) {
            return {
                hasBlocks: false,
                minX: vpX,
                maxX: vpR,
                minY: vpY,
                maxY: vpB,
                vpX,
                vpY,
                screenW,
                screenH
            };
        }

        // Encompass both blocks AND current camera view so user never loses sight of their position
        const combinedMinX = Math.min(minX, vpX);
        const combinedMaxX = Math.max(maxX, vpR);
        const combinedMinY = Math.min(minY, vpY);
        const combinedMaxY = Math.max(maxY, vpB);

        return {
            hasBlocks: true,
            minX: combinedMinX,
            maxX: combinedMaxX,
            minY: combinedMinY,
            maxY: combinedMaxY,
            vpX,
            vpY,
            screenW,
            screenH
        };
    }

    /**
     * Redraws the mini-map canvas with block silhouettes and the camera viewfinder.
     */
    draw() {
        if (!this.ctx || !this.isExpanded) {
            return;
        }

        const ctx = this.ctx;
        const w = this.canvasWidth;
        const h = this.canvasHeight;

        // Reset and clear buffer (accounting for 2x DPR)
        ctx.save();
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const bounds = this.getBounds();

        if (this.emptyHint) {
            this.emptyHint.style.display = bounds.hasBlocks ? "none" : "flex";
        }

        // Add 10% breathing padding around bounds
        const padding = 16;
        const worldW = Math.max(bounds.maxX - bounds.minX, 800);
        const worldH = Math.max(bounds.maxY - bounds.minY, 600);

        const scaleX = (w - padding * 2) / worldW;
        const scaleY = (h - padding * 2) / worldH;
        this.viewScale = Math.min(scaleX, scaleY);

        this.worldMinX = bounds.minX;
        this.worldMinY = bounds.minY;

        // Center within mini-map canvas
        this.offsetX = padding + (w - padding * 2 - worldW * this.viewScale) / 2;
        this.offsetY = padding + (h - padding * 2 - worldH * this.viewScale) / 2;

        // 1. Draw Subtle Background Dots / Grid
        ctx.fillStyle = "rgba(128, 128, 128, 0.15)";
        for (let gx = padding; gx < w - padding; gx += 20) {
            for (let gy = padding; gy < h - padding; gy += 20) {
                ctx.fillRect(gx, gy, 1.5, 1.5);
            }
        }

        // 2. Draw Mini Blocks
        if (bounds.hasBlocks && this.activity.blocks) {
            const blocks = this.activity.blocks.blockList;
            for (const block of blocks) {
                if (!block || block.trash || !block.container) {
                    continue;
                }

                const bx = block.container.x;
                const by = block.container.y;
                const bw = block.width || 60;
                const bh = block.height || 40;

                const mx = this.offsetX + (bx - this.worldMinX) * this.viewScale;
                const my = this.offsetY + (by - this.worldMinY) * this.viewScale;
                const mw = Math.max(bw * this.viewScale, 3);
                const mh = Math.max(bh * this.viewScale, 2.5);

                ctx.fillStyle = this._getBlockColor(block);
                ctx.beginPath();
                ctx.roundRect(mx, my, mw, mh, 1.5);
                ctx.fill();
            }
        }

        // 3. Draw Camera Viewfinder Box
        const vx = this.offsetX + (bounds.vpX - this.worldMinX) * this.viewScale;
        const vy = this.offsetY + (bounds.vpY - this.worldMinY) * this.viewScale;
        const vw = bounds.screenW * this.viewScale;
        const vh = bounds.screenH * this.viewScale;

        this.viewfinder = { x: vx, y: vy, w: vw, h: vh };

        // Viewfinder translucent tint
        ctx.fillStyle = "rgba(59, 130, 246, 0.12)";
        ctx.beginPath();
        ctx.roundRect(vx, vy, vw, vh, 2);
        ctx.fill();

        // Viewfinder glowing accent border
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Converts a mini-map canvas coordinate into world block coordinates.
     * @param {number} cx - Mini-map canvas X
     * @param {number} cy - Mini-map canvas Y
     * @returns {{x: number, y: number}} World coordinates
     */
    canvasToWorld(cx, cy) {
        const wx = (cx - this.offsetX) / this.viewScale + this.worldMinX;
        const wy = (cy - this.offsetY) / this.viewScale + this.worldMinY;
        return { x: wx, y: wy };
    }

    /**
     * Smoothly centers the camera view on the given world coordinate.
     * @param {number} targetX - Target world X coordinate
     * @param {number} targetY - Target world Y coordinate
     */
    navigateTo(targetX, targetY) {
        if (!this.activity.blocksContainer) {
            return;
        }

        const scale =
            typeof this.activity.getStageScale === "function"
                ? this.activity.getStageScale()
                : this.activity.turtleBlocksScale || 1;
        const screenW =
            this.activity.stage && this.activity.stage.canvas
                ? this.activity.stage.canvas.width / scale
                : window.innerWidth / scale;
        const screenH =
            this.activity.stage && this.activity.stage.canvas
                ? this.activity.stage.canvas.height / scale
                : window.innerHeight / scale;

        // Center target in viewport
        this.activity.blocksContainer.x = -(targetX - screenW / 2);
        this.activity.blocksContainer.y = -(targetY - screenH / 2);

        if (typeof this.activity.refreshCanvas === "function") {
            this.activity.refreshCanvas();
        }

        this.draw();
    }

    /**
     * Fits all blocks into view non-destructively by centering the camera.
     * (Preserves relative layouts, unlike the destructive Home button).
     */
    fitAll() {
        const blocks = this.activity.blocks ? this.activity.blocks.blockList : [];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let count = 0;

        for (const block of blocks) {
            if (!block || block.trash || !block.container) continue;
            count++;
            const bx = block.container.x;
            const by = block.container.y;
            const bw = block.width || 60;
            const bh = block.height || 40;

            if (bx < minX) minX = bx;
            if (bx + bw > maxX) maxX = bx + bw;
            if (by < minY) minY = by;
            if (by + bh > maxY) maxY = by + bh;
        }

        if (count === 0) {
            this.navigateTo(300, 200);
            return;
        }

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        this.navigateTo(centerX, centerY);
    }

    /**
     * Handles pointerdown on the mini-map canvas: starts viewfinder drag or centers on click.
     * @private
     */
    _onCanvasPointerDown(event) {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;

        // Check if clicked inside the viewfinder
        const vf = this.viewfinder;
        const inViewfinder = cx >= vf.x && cx <= vf.x + vf.w && cy >= vf.y && cy <= vf.y + vf.h;

        if (inViewfinder) {
            this.isDragging = true;
            this.dragStart = { x: cx, y: cy };
        } else {
            // Click outside viewfinder centers camera on clicked position
            const world = this.canvasToWorld(cx, cy);
            this.navigateTo(world.x, world.y);
            this.isDragging = true;
            this.dragStart = { x: cx, y: cy };
        }
    }

    /**
     * Handles global pointer movement during viewfinder dragging.
     * @private
     */
    _onPointerMove(event) {
        if (!this.isDragging || !this.canvas) {
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;

        const deltaCanvasX = cx - this.dragStart.x;
        const deltaCanvasY = cy - this.dragStart.y;

        this.dragStart = { x: cx, y: cy };

        // Convert mini-map delta to main canvas delta
        const deltaWorldX = deltaCanvasX / this.viewScale;
        const deltaWorldY = deltaCanvasY / this.viewScale;

        if (this.activity.blocksContainer) {
            this.activity.blocksContainer.x -= deltaWorldX;
            this.activity.blocksContainer.y -= deltaWorldY;

            if (typeof this.activity.refreshCanvas === "function") {
                this.activity.refreshCanvas();
            }

            this.draw();
        }
    }

    /**
     * Ends viewfinder drag.
     * @private
     */
    _onPointerUp() {
        this.isDragging = false;
    }

    /**
     * Disposes the controller and cleans up DOM elements and listeners.
     */
    destroy() {
        window.removeEventListener("pointermove", this._handleGlobalPointerMove);
        window.removeEventListener("pointerup", this._handleGlobalPointerUp);

        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }

        this.container = null;
        this.canvas = null;
        this.ctx = null;
    }
}

/**
 * Creates and attaches a MinimapController instance to the Activity singleton.
 * @param {object} activity - The Activity instance.
 * @returns {MinimapController}
 */
const setupMinimapController = activity => {
    const controller = new MinimapController(activity);
    activity.minimapController = controller;
    if (typeof document !== "undefined") {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", () => controller.init());
        } else {
            controller.init();
        }
    }
    return controller;
};

// AMD / RequireJS and CommonJS export pattern
if (typeof define === "function" && define.amd) {
    define(function () {
        window.setupMinimapController = setupMinimapController;
        window.MinimapController = MinimapController;
        return { setupMinimapController, MinimapController };
    });
} else if (typeof module !== "undefined" && module.exports) {
    module.exports = { setupMinimapController, MinimapController };
}
