// ────────────────────────────────────────────────────────────
// Tool Definitions — Creative
// ────────────────────────────────────────────────────────────

import type { ToolDefinition } from "../../types/tools.ts";
import { cached, onDemand, compute } from "./utils.ts";
import {
  EMOJI_KITCHEN_INTERVAL_MS
} from "../../constants.ts";
import { AVATAR_STYLES } from "../AvatarService.ts";

export function getCreativeTools(
  translate: (key: string, variables?: Record<string, string>) => string
): ToolDefinition[] {
  

  return [
  {
    name: "generate_qr_code",
    dataSource: compute("qrcode"),
    description: translate("generate_qr_code.description"),
    endpoint: {
      method: "POST",
      path: "/compute/qr",
      bodyParams: [
        "data",
        "size",
        "errorCorrection",
        "darkColor",
        "lightColor",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        data: {
          type: "string",
          description: translate("generate_qr_code.params.data"),
        },
        size: {
          type: "integer",
          description: translate("generate_qr_code.params.size"),
        },
        errorCorrection: {
          type: "string",
          enum: ["L", "M", "Q", "H"],
          description: translate("generate_qr_code.params.errorCorrection"),
        },
        darkColor: {
          type: "string",
          description: translate("generate_qr_code.params.darkColor"),
        },
        lightColor: {
          type: "string",
          description: translate("generate_qr_code.params.lightColor"),
        },
      },
      required: ["data"],
    },
    display: {
      activeVerb: "Generating QR code for",
      completedVerb: "Generated QR code for",
      subjectParam: "data",
      subjectFormat: "truncate",
    },
  },
  // Inverse of generate_qr_code: decodes QR/barcodes from images via
  // zxing-wasm (ZXing-C++ → WASM, https://github.com/Sec-ant/zxing-wasm).
  {
    name: "scan_barcode",
    dataSource: compute("zxing-wasm"),
    description: translate("scan_barcode.description"),
    endpoint: {
      method: "POST",
      path: "/compute/barcode/scan",
      bodyParams: ["input"],
    },
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: translate("scan_barcode.params.input"),
        },
      },
      required: ["input"],
    },
    display: {
      activeVerb: "Scanning",
      completedVerb: "Scanned",
      subjectParam: "input",
      subjectFormat: "truncate",
    },
  },
  // carbon.now.sh-style code screenshots: Shiki highlighting
  // (https://github.com/shikijs/shiki) rasterized via the shared Playwright
  // Chromium; inspired by charmbracelet/freeze
  // (https://github.com/charmbracelet/freeze) and Aloxaf/silicon
  // (https://github.com/Aloxaf/silicon).
  {
    name: "render_code",
    dataSource: compute("shiki + playwright"),
    description: translate("render_code.description"),
    endpoint: {
      method: "POST",
      path: "/compute/code-image",
      bodyParams: [
        "code",
        "lang",
        "theme",
        "title",
        "windowChrome",
        "background",
        "fontSize",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: translate("render_code.params.code"),
        },
        lang: {
          type: "string",
          description: translate("render_code.params.lang"),
        },
        theme: {
          type: "string",
          enum: [
            "github-dark",
            "github-light",
            "dracula",
            "nord",
            "one-dark-pro",
            "monokai",
            "solarized-light",
            "catppuccin-mocha",
          ],
          description: translate("render_code.params.theme"),
        },
        title: {
          type: "string",
          description: translate("render_code.params.title"),
        },
        windowChrome: {
          type: "boolean",
          description: translate("render_code.params.windowChrome"),
        },
        background: {
          type: "string",
          enum: ["gradient", "plain", "transparent"],
          description: translate("render_code.params.background"),
        },
        fontSize: {
          type: "integer",
          description: translate("render_code.params.fontSize"),
        },
      },
      required: ["code"],
    },
    display: {
      activeVerb: "Rendering code card",
      completedVerb: "Rendered code card",
      subjectParam: "title",
      subjectFormat: "truncate",
    },
  },
  // Deterministic seed→avatar via DiceBear (https://github.com/dicebear/dicebear):
  // same seed + style always yields the identical face; identity primitive
  // for custom agents, NPCs, and project icons.
  {
    name: "generate_avatar",
    dataSource: compute("@dicebear/core"),
    description: translate("generate_avatar.description"),
    endpoint: {
      method: "POST",
      path: "/compute/avatar",
      bodyParams: ["seed", "style", "size", "backgroundColor", "format"],
    },
    parameters: {
      type: "object",
      properties: {
        seed: {
          type: "string",
          description: translate("generate_avatar.params.seed"),
        },
        style: {
          type: "string",
          enum: [...AVATAR_STYLES],
          description: translate("generate_avatar.params.style"),
        },
        size: {
          type: "integer",
          description: translate("generate_avatar.params.size"),
        },
        backgroundColor: {
          type: "string",
          description: translate("generate_avatar.params.backgroundColor"),
        },
        format: {
          type: "string",
          enum: ["png", "svg"],
          description: translate("generate_avatar.params.format"),
        },
      },
      required: ["seed"],
    },
    display: {
      activeVerb: "Generating avatar for",
      completedVerb: "Generated avatar for",
      subjectParam: "seed",
      subjectFormat: "truncate",
    },
  },
  // Inverse of convert_image_to_ascii: text → FIGfont ASCII lettering via
  // figlet.js (https://github.com/patorjk/figlet.js).
  {
    name: "generate_ascii_banner",
    dataSource: compute("figlet"),
    description: translate("generate_ascii_banner.description"),
    endpoint: {
      method: "POST",
      path: "/compute/ascii-banner",
      bodyParams: ["text", "font", "width"],
    },
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: translate("generate_ascii_banner.params.text"),
        },
        font: {
          type: "string",
          description: translate("generate_ascii_banner.params.font"),
        },
        width: {
          type: "integer",
          description: translate("generate_ascii_banner.params.width"),
        },
      },
      required: ["text"],
    },
    display: {
      activeVerb: "Generating banner",
      completedVerb: "Generated banner",
      subjectParam: "text",
      subjectFormat: "truncate",
    },
  },
  {
    name: "convert_color",
    dataSource: compute("internal"),
    description: translate("convert_color.description"),
    endpoint: {
      path: "/compute/color/convert",
      queryParams: ["color", "palette"],
    },
    parameters: {
      type: "object",
      properties: {
        color: {
          type: "string",
          description: translate("convert_color.params.color"),
        },
        palette: {
          type: "string",
          enum: [
            "complementary",
            "analogous",
            "triadic",
            "splitComplementary",
            "tetradic",
            "monochromatic",
          ],
          description: translate("convert_color.params.palette"),
        },
      },
      required: ["color"],
    },
    display: {
      activeVerb: "Converting color values",
      completedVerb: "Converted color values",
      subjectParam: "color",
      subjectFormat: "quoted",
    },
  },
  {
    name: "manipulate_image",
    dataSource: compute("sharp + imagemagick"),
    description: translate("manipulate_image.description"),
    endpoint: {
      method: "POST",
      path: "/compute/image/process",
      bodyParams: ["input", "operations", "outputFormat", "outputQuality"],
    },
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: translate("manipulate_image.params.input"),
        },
        operations: {
          type: "array",
          description: translate("manipulate_image.params.operations"),
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "resize",
                  "crop",
                  "rotate",
                  "flip",
                  "blur",
                  "sharpen",
                  "grayscale",
                  "negate",
                  "tint",
                  "adjust",
                  "gamma",
                  "trim",
                  "extend",
                  "composite",
                  "metadata",
                  "text",
                  "distort",
                  "border",
                ],
                description: translate("manipulate_image.params.operations.items.params.type"),
              },
              width: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.width"),
              },
              height: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.height"),
              },
              fit: {
                type: "string",
                enum: ["cover", "contain", "fill", "inside", "outside"],
                description: translate("manipulate_image.params.operations.items.params.fit"),
              },
              left: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.left"),
              },
              top: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.top"),
              },
              right: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.right"),
              },
              bottom: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.bottom"),
              },
              angle: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.angle"),
              },
              direction: {
                type: "string",
                enum: ["horizontal", "vertical"],
                description: translate("manipulate_image.params.operations.items.params.direction"),
              },
              sigma: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.sigma"),
              },
              color: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.color"),
              },
              background: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.background"),
              },
              brightness: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.brightness"),
              },
              saturation: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.saturation"),
              },
              hue: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.hue"),
              },
              value: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.value"),
              },
              threshold: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.threshold"),
              },
              overlayUrl: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.overlayUrl"),
              },
              gravity: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.gravity"),
              },
              blend: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.blend"),
              },
              content: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.content"),
              },
              font: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.font"),
              },
              fontSize: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.fontSize"),
              },
              strokeColor: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.strokeColor"),
              },
              strokeWidth: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.strokeWidth"),
              },
              x: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.x"),
              },
              y: {
                type: "integer",
                description: translate("manipulate_image.params.operations.items.params.y"),
              },
              effect: {
                type: "string",
                enum: ["swirl", "wave", "implode", "barrel"],
                description: translate("manipulate_image.params.operations.items.params.effect"),
              },
              degrees: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.degrees"),
              },
              amplitude: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.amplitude"),
              },
              wavelength: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.wavelength"),
              },
              factor: {
                type: "number",
                description: translate("manipulate_image.params.operations.items.params.factor"),
              },
              params: {
                type: "string",
                description: translate("manipulate_image.params.operations.items.params.params"),
              },
            },
            required: ["type"],
          },
        },
        outputFormat: {
          type: "string",
          enum: ["png", "jpeg", "webp", "avif", "tiff"],
          description: translate("manipulate_image.params.outputFormat"),
        },
        outputQuality: {
          type: "integer",
          description: translate("manipulate_image.params.outputQuality"),
        },
      },
      required: ["input", "operations"],
    },
    display: {
      activeVerb: "Processing image",
      completedVerb: "Processed image",
      subjectParam: "input",
      subjectFormat: "basename",
      filePathParam: "input",
    },
  },
  {
    name: "convert_image_to_ascii",
    dataSource: compute("sharp"),
    description: translate("convert_image_to_ascii.description"),
    endpoint: {
      method: "POST",
      path: "/compute/image/ascii",
      bodyParams: ["input", "width", "chars", "contrast", "reverse"],
    },
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: translate("convert_image_to_ascii.params.input"),
        },
        width: {
          type: "integer",
          description: translate("convert_image_to_ascii.params.width"),
        },
        chars: {
          type: "string",
          description: translate("convert_image_to_ascii.params.chars"),
        },
        contrast: {
          type: "number",
          description: translate("convert_image_to_ascii.params.contrast"),
        },
        reverse: {
          type: "boolean",
          description: translate("convert_image_to_ascii.params.reverse"),
        },
      },
      required: ["input"],
    },
    display: {
      activeVerb: "Converting image to ASCII",
      completedVerb: "Converted image to ASCII",
      subjectParam: "input",
      subjectFormat: "basename",
      filePathParam: "input",
    },
  },
  {
    name: "draw_turtle_graphics",
    dataSource: compute("LOGO interpreter"),
    description: translate("draw_turtle_graphics.description"),
    endpoint: {
      method: "POST",
      path: "/compute/turtle",
      bodyParams: ["code", "drawingId", "width", "height"],
    },
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: translate("draw_turtle_graphics.params.code"),
        },
        drawingId: {
          type: "string",
          description: translate("draw_turtle_graphics.params.drawingId"),
        },
        width: {
          type: "number",
          description: translate("draw_turtle_graphics.params.width"),
        },
        height: {
          type: "number",
          description: translate("draw_turtle_graphics.params.height"),
        },
      },
      required: ["code"],
    },
    display: {
      activeVerb: "Drawing turtle graphics",
      completedVerb: "Drew turtle graphics",
      subjectParam: "code",
      subjectFormat: "truncate",
    },
  },
  {
    name: "create_3d_mesh",
    dataSource: compute("internal"),
    description: translate("create_3d_mesh.description"),
    endpoint: {
      method: "POST",
      path: "/compute/3d/mesh",
      bodyParams: [
        "vertices",
        "faces",
        "normals",
        "colors",
        "options",
        "sessionId",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: translate("create_3d_mesh.params.sessionId"),
        },
        vertices: {
          type: "array",
          description: translate("create_3d_mesh.params.vertices"),
          items: {
            type: "array",
            items: { type: "number" },
            description: translate("create_3d_mesh.params.items"),
          },
        },
        faces: {
          type: "array",
          description: translate("create_3d_mesh.params.faces"),
          items: {
            type: "array",
            items: { type: "integer" },
            description: translate("create_3d_mesh.params.items2"),
          },
        },
        normals: {
          type: "array",
          description: translate("create_3d_mesh.params.normals"),
          items: {
            type: "array",
            items: { type: "number" },
          },
        },
        colors: {
          type: "array",
          description: translate("create_3d_mesh.params.colors"),
          items: { type: "string" },
        },
        options: {
          type: "object",
          properties: {
            wireframe: {
              type: "boolean",
              description: translate("create_3d_mesh.params.options.params.wireframe"),
            },
            flatShading: {
              type: "boolean",
              description: translate("create_3d_mesh.params.options.params.flatShading"),
            },
            autoRotate: {
              type: "boolean",
              description: translate("create_3d_mesh.params.options.params.autoRotate"),
            },
            showGrid: {
              type: "boolean",
              description: translate("common.params.showGrid"),
            },
            showAxes: {
              type: "boolean",
              description: translate("common.params.showAxes"),
            },
            background: {
              type: "string",
              description: translate("common.params.backgroundColorDefault"),
            },
            meshColor: {
              type: "string",
              description: translate("create_3d_mesh.params.options.params.meshColor"),
            },
            metalness: {
              type: "number",
              description: translate("create_3d_mesh.params.options.params.metalness"),
            },
            roughness: {
              type: "number",
              description: translate("create_3d_mesh.params.options.params.roughness"),
            },
            opacity: {
              type: "number",
              description: translate("create_3d_mesh.params.options.params.opacity"),
            },
            cameraPosition: {
              type: "array",
              items: { type: "number" },
              description: translate("common.params.cameraPositionAutoFit"),
            },
            title: {
              type: "string",
              description: translate("common.params.overlayTitle"),
            },
          },
          description: translate("common.params.renderingOptions"),
        },
      },
      required: ["vertices", "faces"],
    },
    display: {
      activeVerb: "Creating 3D mesh model",
      completedVerb: "Created 3D mesh model",
      subjectParam: "sessionId",
      subjectFormat: "full",
    },
  },
  {
    name: "create_3d_voxel",
    dataSource: compute("internal"),
    description: translate("create_3d_voxel.description"),
    endpoint: {
      method: "POST",
      path: "/compute/3d/voxel",
      bodyParams: ["palette", "slices", "shapes", "options", "sessionId"],
    },
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: translate("create_3d_voxel.params.sessionId"),
        },
        palette: {
          type: "object",
          description: translate("create_3d_voxel.params.palette"),
        },
        slices: {
          type: "array",
          description: translate("create_3d_voxel.params.slices"),
          items: {
            type: "object",
            properties: {
              y: {
                type: "integer",
                description: translate("create_3d_voxel.params.slices.items.params.y"),
              },
              rows: {
                type: "array",
                items: { type: "string" },
                description: translate("create_3d_voxel.params.slices.items.params.rows"),
              },
            },
            required: ["rows"],
          },
        },
        shapes: {
          type: "array",
          description: translate("create_3d_voxel.params.shapes"),
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "box",
                  "sphere",
                  "cylinder",
                  "cone",
                  "pyramid",
                  "ellipsoid",
                  "torus",
                ],
                description: translate("create_3d_voxel.params.shapes.items.params.type"),
              },
              center: {
                type: "array",
                items: { type: "integer" },
                description: translate("create_3d_voxel.params.shapes.items.params.center"),
              },
              color: {
                type: "string",
                description: translate("common.params.cssColor"),
              },
              hollow: {
                type: "boolean",
                description: translate("create_3d_voxel.params.shapes.items.params.hollow"),
              },
              size: {
                type: "array",
                items: { type: "number" },
                description: translate("create_3d_voxel.params.shapes.items.params.size"),
              },
              radius: {
                type: "number",
                description: translate("create_3d_voxel.params.shapes.items.params.radius"),
              },
              height: {
                type: "number",
                description: translate("create_3d_voxel.params.shapes.items.params.height"),
              },
              radii: {
                type: "array",
                items: { type: "number" },
                description: translate("create_3d_voxel.params.shapes.items.params.radii"),
              },
              majorRadius: {
                type: "number",
                description: translate("create_3d_voxel.params.shapes.items.params.majorRadius"),
              },
              minorRadius: {
                type: "number",
                description: translate("create_3d_voxel.params.shapes.items.params.minorRadius"),
              },
              axis: {
                type: "string",
                enum: ["x", "y", "z"],
                description: translate("create_3d_voxel.params.shapes.items.params.axis"),
              },
            },
            required: ["type", "center"],
          },
        },
        options: {
          type: "object",
          properties: {
            background: {
              type: "string",
              description: translate("common.params.backgroundColorDefault"),
            },
            title: {
              type: "string",
              description: translate("common.params.overlayTitle"),
            },
            autoRotate: {
              type: "boolean",
              description: translate("create_3d_voxel.params.options.params.autoRotate"),
            },
            showGrid: {
              type: "boolean",
              description: translate("common.params.showGrid"),
            },
            voxelSize: {
              type: "number",
              description: translate("create_3d_voxel.params.options.params.voxelSize"),
            },
          },
          description: translate("common.params.renderingOptions"),
        },
      },
    },
    display: {
      activeVerb: "Creating voxel build",
      completedVerb: "Created voxel build",
      subjectParam: "sessionId",
      subjectFormat: "full",
    },
  },
  {
    name: "create_3d_scene",
    dataSource: compute("internal"),
    description: translate("create_3d_scene.description"),
    endpoint: {
      method: "POST",
      path: "/compute/3d/scene",
      bodyParams: [
        "scene",
        "objects",
        "options",
        "sessionId",
        "referenceTextureUrl",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: translate("create_3d_scene.params.sessionId"),
        },
        scene: {
          type: "object",
          description: translate("create_3d_scene.params.scene"),
          properties: {
            environment: {
              type: "string",
              enum: [
                "studio",
                "outdoor",
                "night",
                "sunset",
                "dawn",
                "warehouse",
                "neutral",
              ],
              description: translate("create_3d_scene.params.scene.params.environment"),
            },
            background: {
              type: "string",
              description: translate("common.params.backgroundColorDefault"),
            },
            ground: {
              type: "object",
              properties: {
                enabled: {
                  type: "boolean",
                  description: translate("create_3d_scene.params.scene.params.ground.params.enabled"),
                },
                color: {
                  type: "string",
                  description: translate("create_3d_scene.params.scene.params.ground.params.color"),
                },
                size: {
                  type: "number",
                  description: translate("create_3d_scene.params.scene.params.ground.params.size"),
                },
              },
              description: translate("create_3d_scene.params.scene.params.ground"),
            },
            camera: {
              type: "object",
              properties: {
                position: {
                  type: "array",
                  items: { type: "number" },
                  description: translate("create_3d_scene.params.scene.params.camera.params.position"),
                },
                target: {
                  type: "array",
                  items: { type: "number" },
                  description: translate("create_3d_scene.params.scene.params.camera.params.target"),
                },
                fov: {
                  type: "number",
                  description: translate("create_3d_scene.params.scene.params.camera.params.fov"),
                },
                autoOrbit: {
                  type: "boolean",
                  description: translate("create_3d_scene.params.scene.params.camera.params.autoOrbit"),
                },
                autoOrbitSpeed: {
                  type: "number",
                  description: translate("create_3d_scene.params.scene.params.camera.params.autoOrbitSpeed"),
                },
              },
              description: translate("create_3d_scene.params.scene.params.camera"),
            },
            fog: {
              type: "object",
              properties: {
                enabled: {
                  type: "boolean",
                  description: translate("create_3d_scene.params.scene.params.fog.params.enabled"),
                },
                color: {
                  type: "string",
                  description: translate("create_3d_scene.params.scene.params.fog.params.color"),
                },
                near: {
                  type: "number",
                  description: translate("create_3d_scene.params.scene.params.fog.params.near"),
                },
                far: {
                  type: "number",
                  description: translate("create_3d_scene.params.scene.params.fog.params.far"),
                },
              },
              description: translate("create_3d_scene.params.scene.params.fog"),
            },
          },
        },
        objects: {
          type: "array",
          description: translate("create_3d_scene.params.objects"),
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "box",
                  "sphere",
                  "cylinder",
                  "cone",
                  "pyramid",
                  "torus",
                  "torusKnot",
                  "plane",
                  "ring",
                  "circle",
                  "dodecahedron",
                  "icosahedron",
                  "octahedron",
                  "tetrahedron",
                  "capsule",
                  "group",
                  "text3d",
                  "asset",
                ],
                description: translate("create_3d_scene.params.objects.items.params.type"),
              },
              name: { type: "string", description: translate("common.params.optionalName") },
              assetId: {
                type: "string",
                description: translate("create_3d_scene.params.objects.items.params.assetId"),
              },
              size: {
                type: "array",
                items: { type: "number" },
                description: translate("create_3d_scene.params.objects.items.params.size"),
              },
              radius: {
                type: "number",
                description: translate("create_3d_scene.params.objects.items.params.radius"),
              },
              height: {
                type: "number",
                description: translate("create_3d_scene.params.objects.items.params.height"),
              },
              width: {
                type: "number",
                description: translate("create_3d_scene.params.objects.items.params.width"),
              },
              radiusTop: {
                type: "number",
                description: translate("create_3d_scene.params.objects.items.params.radiusTop"),
              },
              radiusBottom: {
                type: "number",
                description: translate("create_3d_scene.params.objects.items.params.radiusBottom"),
              },
              tube: {
                type: "number",
                description: translate("create_3d_scene.params.objects.items.params.tube"),
              },
              segments: {
                type: "integer",
                description: translate("create_3d_scene.params.objects.items.params.segments"),
              },
              position: {
                type: "array",
                items: { type: "number" },
                description: translate("create_3d_scene.params.objects.items.params.position"),
              },
              rotation: {
                type: "array",
                items: { type: "number" },
                description: translate("create_3d_scene.params.objects.items.params.rotation"),
              },
              scale: {
                type: "array",
                items: { type: "number" },
                description: translate("create_3d_scene.params.objects.items.params.scale"),
              },
              material: {
                type: "object",
                properties: {
                  color: { type: "string", description: translate("common.params.cssColor") },
                  metalness: { type: "number", description: translate("common.params.zeroToOne") },
                  roughness: { type: "number", description: translate("common.params.zeroToOne") },
                  opacity: { type: "number", description: translate("common.params.zeroToOne") },
                  emissive: {
                    type: "string",
                    description: translate("create_3d_scene.params.objects.items.params.material.params.emissive"),
                  },
                  wireframe: { type: "boolean" },
                  doubleSided: {
                    type: "boolean",
                    description: translate("create_3d_scene.params.objects.items.params.material.params.doubleSided"),
                  },
                  textureUrl: {
                    type: "string",
                    description: translate("create_3d_scene.params.objects.items.params.material.params.textureUrl"),
                  },
                },
                description: translate("create_3d_scene.params.objects.items.params.material"),
              },
              animation: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["spin", "bounce", "orbit", "pulse", "float"],
                    description: translate("create_3d_scene.params.objects.items.params.children.items.params.animation.params.type"),
                  },
                  speed: {
                    type: "number",
                    description: translate("create_3d_scene.params.objects.items.params.children.items.params.animation.params.speed"),
                  },
                  axis: {
                    type: "string",
                    enum: ["x", "y", "z"],
                    description: translate("create_3d_scene.params.objects.items.params.children.items.params.animation.params.axis"),
                  },
                  amplitude: {
                    type: "number",
                    description: translate("create_3d_scene.params.objects.items.params.children.items.params.animation.params.amplitude"),
                  },
                  radius: {
                    type: "number",
                    description: translate("create_3d_scene.params.objects.items.params.children.items.params.animation.params.radius"),
                  },
                },
                description: translate("create_3d_scene.params.objects.items.params.animation"),
              },
              children: {
                type: "array",
                description: translate("create_3d_scene.params.objects.items.params.children"),
                items: {
                  type: "object",
                  description: translate("create_3d_scene.params.objects.items.params.children.items"),
                  // Google's API requires every `required` name to exist in
                  // `properties` — an object with required but no properties
                  // is rejected with INVALID_ARGUMENT for the whole request.
                  properties: {
                    type: {
                      type: "string",
                      description: translate("create_3d_scene.params.objects.items.params.type"),
                    },
                  },
                  required: ["type"],
                },
              },
              content: {
                type: "string",
                description: translate("create_3d_scene.params.objects.items.params.content"),
              },
              fontSize: {
                type: "number",
                description: translate("create_3d_scene.params.objects.items.params.fontSize"),
              },
            },
            required: ["type"],
          },
        },
        options: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: translate("common.params.overlayTitle"),
            },
            showGrid: {
              type: "boolean",
              description: translate("create_3d_scene.params.options.params.showGrid"),
            },
            showAxes: {
              type: "boolean",
              description: translate("create_3d_scene.params.options.params.showAxes"),
            },
            enableShadows: {
              type: "boolean",
              description: translate("create_3d_scene.params.options.params.enableShadows"),
            },
            ambientLightIntensity: {
              type: "number",
              description: translate("create_3d_scene.params.options.params.ambientLightIntensity"),
            },
            directionalLightIntensity: {
              type: "number",
              description: translate("create_3d_scene.params.options.params.directionalLightIntensity"),
            },
          },
          description: translate("create_3d_scene.params.options"),
        },
      },
      required: ["objects"],
    },
    display: {
      activeVerb: "Creating 3D build",
      completedVerb: "Created 3D build",
      subjectParam: "sessionId",
      subjectFormat: "full",
    },
  },
  {
    name: "get_emoji_combination",
    dataSource: cached("Google Emoji Kitchen", EMOJI_KITCHEN_INTERVAL_MS),
    description: translate("get_emoji_combination.description"),
    endpoint: {
      method: "GET",
      path: "/creative/emoji-kitchen/combine",
      queryParams: ["left", "right"],
    },
    parameters: {
      type: "object",
      properties: {
        left: {
          type: "string",
          description: translate("get_emoji_combination.params.left"),
        },
        right: {
          type: "string",
          description: translate("get_emoji_combination.params.right"),
        },
      },
      required: ["left", "right"],
    },
  },
  {
    name: "get_emoji_combinations",
    dataSource: cached("Google Emoji Kitchen", EMOJI_KITCHEN_INTERVAL_MS),
    description: translate("get_emoji_combinations.description"),
    endpoint: {
      method: "GET",
      path: "/creative/emoji-kitchen/combinations",
      queryParams: ["emoji", "limit"],
    },
    parameters: {
      type: "object",
      properties: {
        emoji: {
          type: "string",
          description: translate("get_emoji_combinations.params.emoji"),
        },
        limit: {
          type: "number",
          description: translate("get_emoji_combinations.params.limit"),
        },
      },
      required: ["emoji"],
    },
  },
  {
    name: "generate_image",

    dataSource: onDemand("Google Gemini via Prism"),
    description: translate("generate_image.description"),
    endpoint: {
      method: "POST",
      path: "/creative/generate-image",
      // referenceLabels is orchestrator-injected (parsed from the message's
      // attached-reference-images block), never agent-supplied — so it is a
      // body param but not an LLM-schema parameter.
      bodyParams: ["prompt", "referenceImages", "referenceLabels", "transparentBackground", "aspectRatio", "size"],
    },
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: translate("generate_image.params.prompt"),
        },
        referenceImages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: translate(
                  "generate_image.params.referenceImages.url",
                ),
              },
              label: {
                type: "string",
                description: translate(
                  "generate_image.params.referenceImages.label",
                ),
              },
            },
            required: ["url"],
          },
          description: translate("generate_image.params.referenceImages"),
        },
        transparentBackground: {
          type: "boolean",
          description: translate("generate_image.params.transparentBackground"),
        },
        aspectRatio: {
          type: "string",
          enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
          description: translate("generate_image.params.aspectRatio"),
        },
        size: {
          type: "string",
          enum: ["1K", "2K", "4K"],
          description: translate("generate_image.params.size"),
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "describe_image",
    dataSource: onDemand("Google Gemini via Prism"),
    description: translate("describe_image.description"),
    endpoint: {
      method: "POST",
      path: "/creative/describe-image",
      bodyParams: ["imageUrls", "context"],
    },
    parameters: {
      type: "object",
      properties: {
        imageUrls: {
          type: "array",
          items: { type: "string" },
          description: translate("describe_image.params.imageUrls"),
        },
        context: {
          type: "string",
          enum: ["avatar", "banner", "photo", "general"],
          description: translate("describe_image.params.context"),
        },
      },
      required: ["imageUrls"],
    },
  },
  // Gemini vision object detection (box_2d normalized 0-1000):
  // https://ai.google.dev/gemini-api/docs/image-understanding
  {
    name: "detect_objects",
    dataSource: onDemand("Google Gemini via Prism"),
    description: translate("detect_objects.description"),
    endpoint: {
      method: "POST",
      path: "/creative/detect-objects",
      bodyParams: ["image", "instruction", "annotate", "maxObjects"],
    },
    parameters: {
      type: "object",
      properties: {
        image: {
          type: "string",
          description: translate("detect_objects.params.image"),
        },
        instruction: {
          type: "string",
          description: translate("detect_objects.params.instruction"),
        },
        annotate: {
          type: "boolean",
          description: translate("detect_objects.params.annotate"),
        },
        maxObjects: {
          type: "integer",
          description: translate("detect_objects.params.maxObjects"),
        },
      },
      required: ["image"],
    },
    display: {
      activeVerb: "Detecting objects in",
      completedVerb: "Detected objects in",
      subjectParam: "instruction",
      subjectFormat: "truncate",
    },
  },
  // Pixel-faithful cut-outs via Gemini segmentation masks (base64 PNG
  // probability maps per box_2d region) applied to the original pixels:
  // https://ai.google.dev/gemini-api/docs/image-understanding
  {
    name: "remove_background",
    dataSource: onDemand("Google Gemini via Prism + sharp"),
    description: translate("remove_background.description"),
    endpoint: {
      method: "POST",
      path: "/creative/remove-background",
      bodyParams: ["image", "subject"],
    },
    parameters: {
      type: "object",
      properties: {
        image: {
          type: "string",
          description: translate("remove_background.params.image"),
        },
        subject: {
          type: "string",
          description: translate("remove_background.params.subject"),
        },
      },
      required: ["image"],
    },
    display: {
      activeVerb: "Removing background from",
      completedVerb: "Removed background from",
      subjectParam: "subject",
      subjectFormat: "truncate",
    },
  },
  {
    name: "synthesize_speech",
    dataSource: onDemand("Inworld / ElevenLabs / OpenAI / Google via Prism"),
    description: translate("synthesize_speech.description"),
    endpoint: {
      path: "/creative/text-to-speech",
      method: "POST",
      bodyParams: ["text", "voice"],
    },
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: translate("synthesize_speech.params.text"),
        },
        voice: {
          type: "string",
          description: translate("synthesize_speech.params.voice"),
        },
      },
      required: ["text"],
    },
  },
  {
    name: "synthesize_speech_local",
    dataSource: compute("espeak-ng (local)"),
    description: translate("synthesize_speech_local.description"),
    endpoint: {
      path: "/creative/local-text-to-speech",
      method: "POST",
      bodyParams: ["text", "voice", "speed", "pitch", "volume", "wordGap"],
    },
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: translate("synthesize_speech_local.params.text"),
        },
        voice: {
          type: "string",
          description: translate("synthesize_speech_local.params.voice"),
        },
        speed: {
          type: "integer",
          description: translate("synthesize_speech_local.params.speed"),
        },
        pitch: {
          type: "integer",
          description: translate("synthesize_speech_local.params.pitch"),
        },
        volume: {
          type: "integer",
          description: translate("synthesize_speech_local.params.volume"),
        },
        wordGap: {
          type: "integer",
          description: translate("synthesize_speech_local.params.wordGap"),
        },
      },
      required: ["text"],
    },
  },
  {
    name: "generate_sound_effect",
    dataSource: onDemand("ElevenLabs Sound Effects via Prism"),
    description: translate("generate_sound_effect.description"),
    endpoint: {
      path: "/creative/sound-effect",
      method: "POST",
      bodyParams: ["prompt", "durationSeconds", "loop"],
    },
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: translate("generate_sound_effect.params.prompt"),
        },
        durationSeconds: {
          type: "number",
          description: translate("generate_sound_effect.params.durationSeconds"),
        },
        loop: {
          type: "boolean",
          description: translate("generate_sound_effect.params.loop"),
        },
      },
      required: ["prompt"],
    },
    display: {
      activeVerb: "Generating a sound effect of",
      completedVerb: "Generated a sound effect of",
      subjectParam: "prompt",
      subjectFormat: "truncate",
    },
  },
  {
    name: "create_vector_animation",
    dataSource: onDemand("Creative Vector Animation Engine"),
    description: translate("create_vector_animation.description"),
    endpoint: {
      method: "POST",
      path: "/creative/vector-animation",
      bodyParams: ["animation", "options", "sessionId", "referenceImageUrl"],
    },
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: translate("create_vector_animation.params.sessionId"),
        },
        options: {
          type: "object",
          properties: {
            loop: {
              type: "boolean",
              description: translate("create_vector_animation.params.options.params.loop"),
            },
            autoplay: {
              type: "boolean",
              description: translate("create_vector_animation.params.options.params.autoplay"),
            },
            title: {
              type: "string",
              description: translate("create_vector_animation.params.options.params.title"),
            },
            snapshot: {
              anyOf: [
                { type: "boolean" },
                { type: "string", enum: ["debug"] },
              ],
              description: translate("create_vector_animation.params.options.params.snapshot"),
            },
            snapshotTimes: {
              type: "array",
              items: { type: "number" },
              description: translate("create_vector_animation.params.options.params.snapshotTimes"),
            },
            export: {
              type: "string",
              enum: ["mp4", "gif"],
              description: translate("create_vector_animation.params.options.params.export"),
            },
            audioUrl: {
              type: "string",
              description: translate("create_vector_animation.params.options.params.audioUrl"),
            },
            includeState: {
              type: "boolean",
              description: translate("create_vector_animation.params.options.params.includeState"),
            },
          },
        },
        animation: {
          type: "object",
          description: translate("create_vector_animation.params.animation"),
          properties: {
            clearSession: {
              type: "boolean",
              description: translate("create_vector_animation.params.animation.params.clearSession"),
            },
            width: {
              type: "integer",
              description: translate("create_vector_animation.params.animation.params.width"),
            },
            height: {
              type: "integer",
              description: translate("create_vector_animation.params.animation.params.height"),
            },
            duration: {
              type: "number",
              description: translate("create_vector_animation.params.animation.params.duration"),
            },
            fps: {
              type: "integer",
              description: translate("create_vector_animation.params.animation.params.fps"),
            },
            background: {
              type: "string",
              description: translate("create_vector_animation.params.animation.params.background"),
            },
            symbols: {
              type: "object",
              description: translate("create_vector_animation.params.animation.params.symbols"),
            },
            retime: {
              type: "object",
              description: translate("create_vector_animation.params.animation.params.retime"),
              properties: {
                scale: {
                  type: "number",
                  description: translate("create_vector_animation.params.animation.params.retime.params.scale"),
                },
                offset: {
                  type: "number",
                  description: translate("create_vector_animation.params.animation.params.retime.params.offset"),
                },
                layerIds: {
                  type: "array",
                  items: { type: "string" },
                  description: translate("create_vector_animation.params.animation.params.retime.params.layerIds"),
                },
              },
            },
            layers: {
              type: "array",
              description: translate("create_vector_animation.params.animation.params.layers"),
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.id"),
                  },
                  action: {
                    type: "string",
                    enum: ["delete"],
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.action"),
                  },
                  replaceKeyframes: {
                    type: "boolean",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.replaceKeyframes"),
                  },
                  shapeType: {
                    type: "string",
                    enum: [
                      "rectangle",
                      "circle",
                      "ellipse",
                      "line",
                      "polygon",
                      "path",
                      "text",
                      "group",
                      "instance",
                      "star",
                      "heart",
                      "arrow",
                      "gear",
                    ],
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.shapeType"),
                  },
                  shapeData: {
                    type: "object",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.shapeData"),
                  },
                  parent: {
                    type: "string",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.parent"),
                  },
                  zIndex: {
                    type: "number",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.zIndex"),
                  },
                  isMask: {
                    type: "boolean",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.isMask"),
                  },
                  maskedBy: {
                    type: "string",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.maskedBy"),
                  },
                  symbol: {
                    type: "string",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.symbol"),
                  },
                  timeScale: {
                    type: "number",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.timeScale"),
                  },
                  timeOffset: {
                    type: "number",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.timeOffset"),
                  },
                  symbolLoop: {
                    type: "boolean",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.symbolLoop"),
                  },
                  blur: {
                    type: "number",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.blur"),
                  },
                  shadowColor: {
                    type: "string",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.shadowColor"),
                  },
                  shadowBlur: {
                    type: "number",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.shadowBlur"),
                  },
                  fillColor: {
                    anyOf: [
                      {
                        type: "string",
                        description: translate("create_vector_animation.params.fillColor"),
                      },
                      {
                        type: "object",
                        description: translate("create_vector_animation.params.fillGradient"),
                        properties: {
                          type: {
                            type: "string",
                            enum: ["linear", "radial"],
                          },
                          x1: {
                            type: "number",
                            description: translate("create_vector_animation.params.x1"),
                          },
                          y1: {
                            type: "number",
                            description: translate("create_vector_animation.params.y1"),
                          },
                          x2: {
                            type: "number",
                            description: translate("create_vector_animation.params.x2"),
                          },
                          y2: {
                            type: "number",
                            description: translate("create_vector_animation.params.y2"),
                          },
                          x0: {
                            type: "number",
                            description: translate("create_vector_animation.params.x0"),
                          },
                          y0: {
                            type: "number",
                            description: translate("create_vector_animation.params.y0"),
                          },
                          r0: {
                            type: "number",
                            description: translate("create_vector_animation.params.r0"),
                          },
                          r1: {
                            type: "number",
                            description: translate("create_vector_animation.params.r1"),
                          },
                          stops: {
                            type: "array",
                            description: translate("create_vector_animation.params.stops"),
                            items: {
                              type: "object",
                              properties: {
                                offset: {
                                  type: "number",
                                  description: translate("create_vector_animation.params.offset"),
                                },
                                color: {
                                  type: "string",
                                  description: translate("create_vector_animation.params.color"),
                                },
                              },
                              required: ["offset", "color"],
                            },
                          },
                        },
                        required: ["type", "stops"],
                      },
                    ],
                  },
                  strokeColor: {
                    anyOf: [
                      {
                        type: "string",
                        description: translate("create_vector_animation.params.strokeColor"),
                      },
                      {
                        type: "object",
                        description: translate("create_vector_animation.params.strokeGradient"),
                      },
                    ],
                  },
                  strokeWidth: {
                    type: "number",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.strokeWidth"),
                  },
                  opacity: {
                    type: "number",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.opacity"),
                  },
                  imageUrl: {
                    type: "string",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.imageUrl"),
                  },
                  keyframes: {
                    type: "array",
                    description: translate("create_vector_animation.params.animation.params.layers.items.params.keyframes"),
                    items: {
                      type: "object",
                      properties: {
                        time: {
                          type: "number",
                          description: translate("create_vector_animation.params.animation.params.layers.items.params.keyframes.items.params.time"),
                        },
                        easing: {
                          type: "string",
                          description: translate("create_vector_animation.params.animation.params.layers.items.params.keyframes.items.params.easing"),
                        },
                        motionPath: {
                          type: "object",
                          description: translate("create_vector_animation.params.animation.params.layers.items.params.keyframes.items.params.motionPath"),
                          properties: {
                            path: {
                              type: "string",
                              description: translate("create_vector_animation.params.animation.params.layers.items.params.keyframes.items.params.motionPath.params.path"),
                            },
                            orientToPath: {
                              type: "boolean",
                              description: translate("create_vector_animation.params.animation.params.layers.items.params.keyframes.items.params.motionPath.params.orientToPath"),
                            },
                          },
                        },
                        properties: {
                          type: "object",
                          description: translate("create_vector_animation.params.animation.params.layers.items.params.keyframes.items.params.properties"),
                        },
                      },
                      required: ["time", "properties"],
                    },
                  },
                },
                required: ["id"],
              },
            },
          },
          required: ["layers"],
        },
      },
      required: ["animation"],
    },
  },
  {
    name: "generate_audio",
    dataSource: compute("SoundSynthesizerService"),
    description: translate("generate_audio.description"),
    endpoint: {
      path: "/creative/generate-audio",
      method: "POST",
      bodyParams: [
        "action",
        "sessionId",
        "channelId",
        "linesPerBeat",
        "rows",
        "append",
        "startRow",
        "clearSession",
        "duration",
        "waveform",
        "sampleRate",
        "tempo",
        "nodes",
        "instrument",
        "swing",
        "humanize",
        "timeSignature",
        "volume",
        "effects",
        "nodeChain",
        "sampleSource",
        "sampleRootNote",
        "sampleLoop",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["init", "add_channel", "write_pattern", "render"],
          description: translate("generate_audio.params.action"),
        },
        sessionId: {
          type: "string",
          description: translate("generate_audio.params.sessionId"),
        },
        channelId: {
          type: "string",
          description: translate("generate_audio.params.channelId"),
        },
        volume: {
          type: "number",
          description: translate("generate_audio.params.volume"),
        },
        sampleSource: {
          type: "string",
          description: translate("generate_audio.params.sampleSource"),
        },
        sampleRootNote: {
          type: "string",
          description: translate("generate_audio.params.sampleRootNote"),
        },
        sampleLoop: {
          type: "boolean",
          description: translate("generate_audio.params.sampleLoop"),
        },
        linesPerBeat: {
          type: "integer",
          description: translate("generate_audio.params.linesPerBeat"),
        },
        effects: {
          type: "object",
          description: translate("generate_audio.params.effects"),
          properties: {
            reverb: {
              type: "object",
              properties: {
                wet: { type: "number", description: translate("generate_audio.params.wet") },
                decayTime: { type: "number", description: translate("generate_audio.params.decayTime") },
              },
            },
            delay: {
              type: "object",
              properties: {
                delayTime: { type: "number", description: translate("generate_audio.params.delayTime") },
                feedback: { type: "number", description: translate("generate_audio.params.feedback") },
                pingPong: { type: "boolean", description: translate("generate_audio.params.pingPong") },
              },
            },
            filter: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["lowpass", "highpass", "bandpass"] },
                cutoff: { type: "number", description: translate("generate_audio.params.cutoff") },
                Q: { type: "number", description: translate("generate_audio.params.Q") },
              },
            },
            distortion: {
              type: "object",
              properties: {
                algorithm: { type: "string", enum: ["soft_clip", "hard_clip", "bitcrush"] },
                drive: { type: "number", description: translate("generate_audio.params.drive") },
              },
            },
          },
        },
        rows: {
          type: "array",
          description: translate("generate_audio.params.rows"),
          items: {
            type: "object",
            properties: {
              note: {
                type: "string",
                description: translate("generate_audio.params.rows.items.params.note"),
              },
              velocity: {
                type: "number",
                description: translate("generate_audio.params.rows.items.params.velocity"),
              },
              duration: {
                type: "string",
                description: translate("generate_audio.params.rows.items.params.duration"),
              },
              pitchBend: {
                type: "object",
                description: translate("generate_audio.params.rows.items.params.pitchBend"),
                properties: {
                  target: {
                    type: "string",
                    description: translate("generate_audio.params.rows.items.params.pitchBend.params.target"),
                  },
                  startTime: {
                    type: "number",
                    description: translate("generate_audio.params.rows.items.params.pitchBend.params.startTime"),
                  },
                  endTime: {
                    type: "number",
                    description: translate("generate_audio.params.rows.items.params.pitchBend.params.endTime"),
                  },
                },
                required: ["target"],
              },
            },
            required: ["note", "duration"],
          },
        },
        append: {
          type: "boolean",
          description: translate("generate_audio.params.append"),
        },
        startRow: {
          type: "integer",
          description: translate("generate_audio.params.startRow"),
        },
        clearSession: {
          type: "boolean",
          description: translate("generate_audio.params.clearSession"),
        },
        duration: {
          type: "number",
          description: translate("generate_audio.params.duration"),
        },
        waveform: {
          type: "string",
          enum: ["sine", "triangle", "sawtooth", "square", "noise"],
          description: translate("generate_audio.params.waveform"),
        },
        sampleRate: {
          type: "number",
          description: translate("generate_audio.params.sampleRate"),
        },
        tempo: {
          type: "number",
          description: translate("generate_audio.params.tempo"),
        },
        nodes: {
          type: "object",
          description: translate("generate_audio.params.nodes"),
        },
        nodeChain: {
          type: "array",
          items: { type: "string" },
          description: translate("generate_audio.params.nodeChain"),
        },
        instrument: {
          type: "string",
          enum: [
            "acoustic_guitar",
            "electric_guitar",
            "nylon_guitar",
            "piano",
            "electric_piano",
            "organ",
            "trumpet",
            "violin",
            "cello",
            "flute",
            "clarinet",
            "synth_lead",
            "synth_pad",
            "synth_bass",
            "bass_guitar",
            "marimba",
            "vibraphone",
            "harmonica",
          ],
          description: translate("generate_audio.params.instrument"),
        },
        swing: {
          type: "number",
          description: translate("generate_audio.params.swing"),
        },
        humanize: {
          type: "number",
          description: translate("generate_audio.params.humanize"),
        },
        timeSignature: {
          type: "array",
          items: { type: "integer" },
          description: translate("generate_audio.params.timeSignature"),
        },
      },
      required: ["action"],
    },
  },
  {
    name: "remix_audio",
    dataSource: compute("ffmpeg"),
    description: translate("remix_audio.description"),
    endpoint: {
      path: "/creative/remix-audio",
      method: "POST",
      bodyParams: [
        "input", "operations", "preset", "outputFormat", "sampleRate",
        "overlays", "concatenate", "mixDuration",
      ],
    },
    parameters: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: translate("remix_audio.params.input"),
        },
        overlays: {
          type: "array",
          description: translate("remix_audio.params.overlays"),
          items: {
            type: "object",
            properties: {
              source: {
                type: "string",
                description: translate("remix_audio.params.overlays.items.params.source"),
              },
              offset: {
                type: "number",
                description: translate("remix_audio.params.overlays.items.params.offset"),
              },
              volume: {
                type: "number",
                description: translate("remix_audio.params.overlays.items.params.volume"),
              },
            },
            required: ["source"],
          },
        },
        concatenate: {
          type: "array",
          items: { type: "string" },
          description: translate("remix_audio.params.concatenate"),
        },
        mixDuration: {
          type: "string",
          enum: ["first", "longest"],
          description: translate("remix_audio.params.mixDuration"),
        },
        operations: {
          type: "array",
          description: translate("remix_audio.params.operations"),
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "pitch_shift", "tempo", "speed", "reverb", "echo",
                  "lowpass", "highpass", "bandpass", "equalizer",
                  "bass_boost", "treble_boost", "distortion",
                  "chorus", "flanger", "phaser", "tremolo", "vibrato",
                  "compressor", "normalize", "reverse",
                  "fade_in", "fade_out", "trim", "volume",
                  "stereo_pan", "bitcrush", "crystalizer",
                ],
                description: translate("remix_audio.params.operations.items.params.type"),
              },
              semitones: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.semitones"),
              },
              factor: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.factor"),
              },
              delay: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.delay"),
              },
              decay: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.decay"),
              },
              delays: {
                type: "array",
                items: { type: "number" },
                description: translate("remix_audio.params.operations.items.params.delays"),
              },
              decays: {
                type: "array",
                items: { type: "number" },
                description: translate("remix_audio.params.operations.items.params.decays"),
              },
              frequency: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.frequency"),
              },
              width: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.width"),
              },
              gain: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.gain"),
              },
              color: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.color"),
              },
              depth: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.depth"),
              },
              speed: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.speed"),
              },
              threshold: { type: "number", description: translate("remix_audio.params.threshold") },
              ratio: { type: "number", description: translate("remix_audio.params.ratio") },
              attack: { type: "number", description: translate("remix_audio.params.attack") },
              release: { type: "number", description: translate("remix_audio.params.release") },
              duration: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.duration"),
              },
              start: { type: "number", description: translate("remix_audio.params.start") },
              end: { type: "number", description: translate("remix_audio.params.end") },
              level: { type: "number", description: translate("remix_audio.params.level") },
              pan: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.pan"),
              },
              bits: { type: "number", description: translate("remix_audio.params.bits") },
              sampleRate: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.sampleRate"),
              },
              intensity: {
                type: "number",
                description: translate("remix_audio.params.operations.items.params.intensity"),
              },
            },
            required: ["type"],
          },
        },
        preset: {
          type: "string",
          enum: [
            "chipmunk", "demon_voice", "nightcore", "vaporwave",
            "slowed_reverb", "underwater", "radio", "telephone",
            "robot", "cave", "vinyl", "megaphone",
          ],
          description: translate("remix_audio.params.preset"),
        },
        outputFormat: {
          type: "string",
          enum: ["wav", "mp3", "ogg", "opus"],
          description: translate("remix_audio.params.outputFormat"),
        },
        sampleRate: {
          type: "number",
          description: translate("remix_audio.params.sampleRate"),
        },
      },
      required: ["input"],
    },
  },
  {
    name: "transcribe_audio",
    dataSource: onDemand("OpenAI Whisper / Google via Prism"),
    description: translate("transcribe_audio.description"),
    endpoint: {
      path: "/creative/speech-to-text",
      method: "POST",
      bodyParams: ["audioUrl", "audio", "provider", "model", "language"],
    },
    parameters: {
      type: "object",
      properties: {
        audioUrl: {
          type: "string",
          description: translate("transcribe_audio.params.audioUrl"),
        },
        audio: {
          type: "string",
          description: translate("transcribe_audio.params.audio"),
        },
        provider: {
          type: "string",
          description: translate("transcribe_audio.params.provider"),
          enum: ["openai", "google"],
        },
        model: {
          type: "string",
          description: translate("transcribe_audio.params.model"),
        },
        language: {
          type: "string",
          description: translate("transcribe_audio.params.language"),
        },
      },
    },
  },
  ];
}
