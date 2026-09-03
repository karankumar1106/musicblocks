// Copyright (c) 2026 Sugarlabs
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the The GNU Affero General Public
// License as published by the Free Software Foundation; either
// version 3 of the License, or (at your option) any later version.

const { setupMinimapController, MinimapController } = require("../minimap-controller");

describe("MinimapController", () => {
    let mockActivity;
    let controller;

    beforeEach(() => {
        // Clear DOM
        document.body.innerHTML = '<div id="canvasHolder"></div>';

        // Mock 2D canvas context
        HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
            save: jest.fn(),
            restore: jest.fn(),
            setTransform: jest.fn(),
            clearRect: jest.fn(),
            beginPath: jest.fn(),
            roundRect: jest.fn(),
            fill: jest.fn(),
            stroke: jest.fn(),
            fillRect: jest.fn(),
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 1
        }));

        mockActivity = {
            stage: {
                canvas: { width: 1200, height: 900 }
            },
            blocksContainer: { x: 0, y: 0 },
            turtleBlocksScale: 1,
            getStageScale: jest.fn(() => 1),
            refreshCanvas: jest.fn(),
            blocks: {
                blockList: []
            }
        };

        global._ = text => text;
    });

    afterEach(() => {
        if (controller) {
            controller.destroy();
            controller = null;
        }
        jest.clearAllMocks();
    });

    describe("Initialization and DOM Mounting", () => {
        test("setupMinimapController creates instance and attaches to activity", () => {
            controller = setupMinimapController(mockActivity);

            expect(mockActivity.minimapController).toBeInstanceOf(MinimapController);
            expect(document.getElementById("minimap-container")).not.toBeNull();
            expect(controller.pillBtn).not.toBeNull();
            expect(controller.card).not.toBeNull();
            expect(controller.canvas).not.toBeNull();
        });

        test("starts in collapsed state by default", () => {
            controller = setupMinimapController(mockActivity);

            expect(controller.isExpanded).toBe(false);
            expect(controller.pillBtn.style.display).toBe("flex");
            expect(controller.card.style.display).toBe("none");
        });

        test("toggle() flips expansion state and DOM display", () => {
            controller = setupMinimapController(mockActivity);

            controller.toggle(true);
            expect(controller.isExpanded).toBe(true);
            expect(controller.pillBtn.style.display).toBe("none");
            expect(controller.card.style.display).toBe("flex");

            controller.toggle(false);
            expect(controller.isExpanded).toBe(false);
            expect(controller.pillBtn.style.display).toBe("flex");
            expect(controller.card.style.display).toBe("none");
        });
    });

    describe("Bounds & Bounding Box Calculation", () => {
        test("returns empty metrics when no blocks exist", () => {
            controller = setupMinimapController(mockActivity);
            const bounds = controller.getBounds();

            expect(bounds.hasBlocks).toBe(false);
            expect(bounds.vpX).toBe(0);
            expect(bounds.vpY).toBe(0);
            expect(bounds.screenW).toBe(1200);
            expect(bounds.screenH).toBe(900);
        });

        test("calculates enclosing bounds across active blocks", () => {
            mockActivity.blocks.blockList = [
                {
                    trash: false,
                    container: { x: 100, y: 150 },
                    width: 80,
                    height: 50,
                    protoblock: { palette: { name: "action" } }
                },
                {
                    trash: false,
                    container: { x: 400, y: 600 },
                    width: 100,
                    height: 60,
                    protoblock: { palette: { name: "pitch" } }
                }
            ];

            controller = setupMinimapController(mockActivity);
            const bounds = controller.getBounds();

            expect(bounds.hasBlocks).toBe(true);
            expect(bounds.minX).toBeLessThanOrEqual(100);
            expect(bounds.maxX).toBeGreaterThanOrEqual(500);
            expect(bounds.minY).toBeLessThanOrEqual(150);
            expect(bounds.maxY).toBeGreaterThanOrEqual(660);
        });

        test("ignores trashed blocks when calculating bounds", () => {
            mockActivity.blocks.blockList = [
                {
                    trash: false,
                    container: { x: 200, y: 200 },
                    width: 50,
                    height: 50
                },
                {
                    trash: true,
                    container: { x: 9999, y: 9999 },
                    width: 50,
                    height: 50
                }
            ];

            controller = setupMinimapController(mockActivity);
            const bounds = controller.getBounds();

            expect(bounds.maxX).toBeLessThan(5000);
            expect(bounds.maxY).toBeLessThan(5000);
        });
    });

    describe("Drawing and Palette Color Mapping", () => {
        test("maps block palette family to correct visual colors", () => {
            controller = setupMinimapController(mockActivity);

            expect(
                controller._getBlockColor({
                    protoblock: { palette: { name: "action" } }
                })
            ).toBe("#ab47bc");
            expect(
                controller._getBlockColor({
                    protoblock: { palette: { name: "pitch" } }
                })
            ).toBe("#fb8c00");
            expect(
                controller._getBlockColor({
                    protoblock: { palette: { name: "drum" } }
                })
            ).toBe("#8d6e63");
            expect(controller._getBlockColor({})).toBe("#78909c");
        });

        test("draw() renders canvas elements when expanded", () => {
            mockActivity.blocks.blockList = [
                {
                    trash: false,
                    container: { x: 200, y: 200 },
                    width: 60,
                    height: 40,
                    protoblock: { palette: { name: "number" } }
                }
            ];

            controller = setupMinimapController(mockActivity);
            controller.toggle(true);
            controller.draw();

            expect(controller.ctx.clearRect).toHaveBeenCalled();
            expect(controller.ctx.stroke).toHaveBeenCalled();
            expect(controller.viewfinder.w).toBeGreaterThan(0);
        });
    });

    describe("Navigation & Camera Control", () => {
        test("navigateTo centers camera on target world coordinates", () => {
            controller = setupMinimapController(mockActivity);

            // Screen is 1200x900. To center at (500, 400):
            // blocksContainer.x = -(500 - 600) = 100
            // blocksContainer.y = -(400 - 450) = 50
            controller.navigateTo(500, 400);

            expect(mockActivity.blocksContainer.x).toBe(100);
            expect(mockActivity.blocksContainer.y).toBe(50);
            expect(mockActivity.refreshCanvas).toHaveBeenCalled();
        });

        test("fitAll calculates bounding center and navigates without rearranging blocks", () => {
            mockActivity.blocks.blockList = [
                {
                    trash: false,
                    container: { x: 100, y: 100 },
                    width: 100,
                    height: 100
                },
                {
                    trash: false,
                    container: { x: 500, y: 500 },
                    width: 100,
                    height: 100
                }
            ];

            controller = setupMinimapController(mockActivity);
            controller.fitAll();

            // Bounds are X: 100 to 600 (center = 350), Y: 100 to 600 (center = 350)
            // Screen center is (600, 450)
            // blocksContainer.x = -(350 - 600) = 250
            // blocksContainer.y = -(350 - 450) = 100
            expect(mockActivity.blocksContainer.x).toBe(250);
            expect(mockActivity.blocksContainer.y).toBe(100);
            expect(mockActivity.refreshCanvas).toHaveBeenCalled();
        });

        test("canvasToWorld translates mini-map coordinates accurately", () => {
            controller = setupMinimapController(mockActivity);
            controller.viewScale = 0.1;
            controller.offsetX = 10;
            controller.offsetY = 10;
            controller.worldMinX = 50;
            controller.worldMinY = 50;

            const world = controller.canvasToWorld(20, 30);
            // (20 - 10) / 0.1 + 50 = 100 + 50 = 150
            // (30 - 10) / 0.1 + 50 = 200 + 50 = 250
            expect(world.x).toBe(150);
            expect(world.y).toBe(250);
        });
    });

    describe("Pointer Interactions", () => {
        test("pointer down outside viewfinder triggers camera navigation", () => {
            controller = setupMinimapController(mockActivity);
            controller.toggle(true);
            controller.draw();

            controller.canvas.getBoundingClientRect = () => ({
                left: 0,
                top: 0,
                width: 210,
                height: 135
            });

            // Set viewfinder at (10, 10, 50, 50)
            controller.viewfinder = { x: 10, y: 10, w: 50, h: 50 };

            // Click at (150, 100) outside viewfinder
            const event = new MouseEvent("pointerdown", {
                clientX: 150,
                clientY: 100
            });
            event.preventDefault = jest.fn();

            controller.canvas.dispatchEvent(event);

            expect(mockActivity.refreshCanvas).toHaveBeenCalled();
            expect(controller.isDragging).toBe(true);
        });

        test("pointer move while dragging pans the main canvas", () => {
            controller = setupMinimapController(mockActivity);
            controller.toggle(true);
            controller.draw();

            controller.canvas.getBoundingClientRect = () => ({
                left: 0,
                top: 0,
                width: 210,
                height: 135
            });

            controller.isDragging = true;
            controller.dragStart = { x: 50, y: 50 };
            controller.viewScale = 0.2;
            mockActivity.blocksContainer = { x: 100, y: 100 };

            const moveEvent = new MouseEvent("pointermove", {
                clientX: 60,
                clientY: 70
            });
            window.dispatchEvent(moveEvent);

            // deltaCanvasX = 10 -> deltaWorldX = 10 / 0.2 = 50
            // deltaCanvasY = 20 -> deltaWorldY = 20 / 0.2 = 100
            // blocksContainer.x -= 50 -> 50
            // blocksContainer.y -= 100 -> 0
            expect(mockActivity.blocksContainer.x).toBe(50);
            expect(mockActivity.blocksContainer.y).toBe(0);
            expect(mockActivity.refreshCanvas).toHaveBeenCalled();
        });

        test("pointer up ends dragging state", () => {
            controller = setupMinimapController(mockActivity);
            controller.isDragging = true;

            window.dispatchEvent(new MouseEvent("pointerup"));
            expect(controller.isDragging).toBe(false);
        });
    });

    describe("Teardown & Cleanup", () => {
        test("destroy removes container from DOM and cleans up references", () => {
            controller = setupMinimapController(mockActivity);
            expect(document.getElementById("minimap-container")).not.toBeNull();

            controller.destroy();
            expect(document.getElementById("minimap-container")).toBeNull();
            expect(controller.container).toBeNull();
            expect(controller.canvas).toBeNull();
        });
    });
});
