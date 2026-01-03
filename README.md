# 3D Level Prototyping Tool

A fast, web-based 3D level editor inspired by Unity's ProBuilder. Built with Three.js.

## Features

- **Box Drawing**: Click and drag on any surface to draw boxes. First draw the base rectangle, then extrude height.
- **Multi-Select**: Ctrl+click to select multiple boxes
- **Move Mode (W)**: RGB axis arrows + 2-axis plane handles to move selected boxes
- **Scale Mode (S)**: Yellow cone handles on each face to resize (single selection only)
- **Grid Snapping**: Configurable grid size (default 0.5)
- **Color Picker**: Change color of selected boxes
- **Sun/Shadows**: Adjustable sun azimuth and elevation

## Controls

| Action | Control |
|--------|---------|
| Draw box | Click + drag on ground/surface |
| Select | Click on box |
| Multi-select | Ctrl + click |
| Deselect | Click on empty space / Escape |
| Move mode | W |
| Scale mode | S |
| Toggle mode | F |
| Delete | Delete / Backspace |
| Duplicate | Ctrl + D |
| Pan | Middle mouse |
| Rotate view | Right mouse |

## Getting Started

```bash
npm install
npm run dev
```

## Tech Stack

- Three.js
- Vite
