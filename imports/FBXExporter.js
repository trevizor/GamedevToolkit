class ByteWriter {
  constructor() {
    this.bytes = [];
  }

  get length() {
    return this.bytes.length;
  }

  writeUint8(value) {
    this.bytes.push(value & 0xff);
  }

  writeUint32(value) {
    this.writeUint8(value & 0xff);
    this.writeUint8((value >>> 8) & 0xff);
    this.writeUint8((value >>> 16) & 0xff);
    this.writeUint8((value >>> 24) & 0xff);
  }

  writeInt32(value) {
    this.writeUint32(value >>> 0);
  }

  writeInt64(value) {
    let big = BigInt(value);
    if (big < 0) {
      big = (1n << 64n) + big;
    }
    for (let i = 0n; i < 8n; i += 1n) {
      this.writeUint8(Number((big >> (8n * i)) & 0xffn));
    }
  }

  writeFloat64(value) {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setFloat64(0, value, true);
    this.writeBytes(new Uint8Array(buf));
  }

  writeString(value) {
    const encoded = new TextEncoder().encode(value);
    this.writeBytes(encoded);
  }

  writeBytes(bytes) {
    for (let i = 0; i < bytes.length; i += 1) {
      this.bytes.push(bytes[i]);
    }
  }

  writeZeros(count) {
    for (let i = 0; i < count; i += 1) {
      this.bytes.push(0);
    }
  }

  toUint8Array() {
    return new Uint8Array(this.bytes);
  }
}

function encodeProperty(property) {
  const writer = new ByteWriter();

  switch (property.type) {
    case "S": {
      const encoded = new TextEncoder().encode(property.value);
      writer.writeUint8("S".charCodeAt(0));
      writer.writeUint32(encoded.length);
      writer.writeBytes(encoded);
      break;
    }
    case "I":
      writer.writeUint8("I".charCodeAt(0));
      writer.writeInt32(property.value);
      break;
    case "L":
      writer.writeUint8("L".charCodeAt(0));
      writer.writeInt64(property.value);
      break;
    case "D":
      writer.writeUint8("D".charCodeAt(0));
      writer.writeFloat64(property.value);
      break;
    case "d": {
      writer.writeUint8("d".charCodeAt(0));
      writer.writeUint32(property.value.length);
      writer.writeUint32(0);
      writer.writeUint32(property.value.length * 8);
      for (let i = 0; i < property.value.length; i += 1) {
        writer.writeFloat64(property.value[i]);
      }
      break;
    }
    case "i": {
      writer.writeUint8("i".charCodeAt(0));
      writer.writeUint32(property.value.length);
      writer.writeUint32(0);
      writer.writeUint32(property.value.length * 4);
      for (let i = 0; i < property.value.length; i += 1) {
        writer.writeInt32(property.value[i]);
      }
      break;
    }
    default:
      throw new Error("Unsupported FBX property type: " + property.type);
  }

  return writer.toUint8Array();
}

function buildNodeBytes(node, startOffset) {
  const nameBytes = new TextEncoder().encode(node.name);

  const propertyBuffers = [];
  let propertyListLength = 0;
  for (let i = 0; i < node.properties.length; i += 1) {
    const encoded = encodeProperty(node.properties[i]);
    propertyBuffers.push(encoded);
    propertyListLength += encoded.length;
  }

  const childBuffers = [];
  let childrenLength = 0;
  let childStart = startOffset + 13 + nameBytes.length + propertyListLength;
  for (let i = 0; i < node.children.length; i += 1) {
    const child = buildNodeBytes(node.children[i], childStart);
    childBuffers.push(child);
    childrenLength += child.length;
    childStart += child.length;
  }

  const nullRecordLength = node.children.length > 0 ? 13 : 0;
  const totalLength = 13 + nameBytes.length + propertyListLength + childrenLength + nullRecordLength;
  const endOffset = startOffset + totalLength;

  const writer = new ByteWriter();
  writer.writeUint32(endOffset);
  writer.writeUint32(node.properties.length);
  writer.writeUint32(propertyListLength);
  writer.writeUint8(nameBytes.length);
  writer.writeBytes(nameBytes);

  for (let i = 0; i < propertyBuffers.length; i += 1) {
    writer.writeBytes(propertyBuffers[i]);
  }
  for (let i = 0; i < childBuffers.length; i += 1) {
    writer.writeBytes(childBuffers[i]);
  }

  if (node.children.length > 0) {
    writer.writeZeros(13);
  }

  return writer.toUint8Array();
}

class FBXExporter {
  parse(meshData, onDone, onError) {
    try {
      if (!meshData || !Array.isArray(meshData.vertices) || !Array.isArray(meshData.faces)) {
        throw new Error("Invalid meshData. Expected vertices and faces arrays.");
      }
      if (meshData.vertices.length === 0 || meshData.faces.length === 0) {
        throw new Error("Mesh data is empty.");
      }

      const modelName = meshData.name || "GeneratedMesh";
      const geomId = 100000;
      const modelId = 100001;

      const vertices = [];
      for (let i = 0; i < meshData.vertices.length; i += 1) {
        const v = meshData.vertices[i];
        if (!Array.isArray(v) || v.length !== 3) {
          throw new Error("Each vertex must be [x,y,z].");
        }
        vertices.push(v[0], v[1], v[2]);
      }

      const polygonIndices = [];
      for (let i = 0; i < meshData.faces.length; i += 1) {
        const face = meshData.faces[i];
        if (!Array.isArray(face) || face.length !== 3) {
          throw new Error("Each face must be 3 indices.");
        }
        polygonIndices.push(face[0], face[1], -(face[2] + 1));
      }

      const pNode = (name, type, dataType, flags, value) => ({
        name: "P",
        properties: [
          { type: "S", value: name },
          { type: "S", value: type },
          { type: "S", value: dataType },
          { type: "S", value: flags },
          { type: typeof value === "number" && Number.isInteger(value) ? "I" : "D", value }
        ],
        children: []
      });

      const nodes = [
        {
          name: "FBXHeaderExtension",
          properties: [],
          children: [
            { name: "FBXHeaderVersion", properties: [{ type: "I", value: 1003 }], children: [] },
            { name: "FBXVersion", properties: [{ type: "I", value: 7400 }], children: [] }
          ]
        },
        {
          name: "GlobalSettings",
          properties: [],
          children: [
            { name: "Version", properties: [{ type: "I", value: 1000 }], children: [] },
            {
              name: "Properties70",
              properties: [],
              children: [
                pNode("UpAxis", "int", "Integer", "", 1),
                pNode("UpAxisSign", "int", "Integer", "", 1),
                pNode("FrontAxis", "int", "Integer", "", 2),
                pNode("FrontAxisSign", "int", "Integer", "", 1),
                pNode("CoordAxis", "int", "Integer", "", 0),
                pNode("CoordAxisSign", "int", "Integer", "", 1),
                pNode("UnitScaleFactor", "double", "Number", "", 1)
              ]
            }
          ]
        },
        {
          name: "Definitions",
          properties: [],
          children: [
            { name: "Version", properties: [{ type: "I", value: 100 }], children: [] },
            { name: "Count", properties: [{ type: "I", value: 4 }], children: [] },
            {
              name: "ObjectType",
              properties: [{ type: "S", value: "Model" }],
              children: [{ name: "Count", properties: [{ type: "I", value: 2 }], children: [] }]
            },
            {
              name: "ObjectType",
              properties: [{ type: "S", value: "Geometry" }],
              children: [{ name: "Count", properties: [{ type: "I", value: 1 }], children: [] }]
            }
          ]
        },
        {
          name: "Objects",
          properties: [],
          children: [
            {
              name: "Model",
              properties: [
                { type: "L", value: 0 },
                { type: "S", value: "Model::Scene" },
                { type: "S", value: "Null" }
              ],
              children: [{ name: "Version", properties: [{ type: "I", value: 232 }], children: [] }]
            },
            {
              name: "Geometry",
              properties: [
                { type: "L", value: geomId },
                { type: "S", value: "Geometry::" + modelName },
                { type: "S", value: "Mesh" }
              ],
              children: [
                { name: "Vertices", properties: [{ type: "d", value: vertices }], children: [] },
                { name: "PolygonVertexIndex", properties: [{ type: "i", value: polygonIndices }], children: [] }
              ]
            },
            {
              name: "Model",
              properties: [
                { type: "L", value: modelId },
                { type: "S", value: "Model::" + modelName },
                { type: "S", value: "Mesh" }
              ],
              children: [
                { name: "Version", properties: [{ type: "I", value: 232 }], children: [] },
                {
                  name: "Properties70",
                  properties: [],
                  children: [
                    {
                      name: "P",
                      properties: [
                        { type: "S", value: "Lcl Translation" },
                        { type: "S", value: "Lcl Translation" },
                        { type: "S", value: "" },
                        { type: "S", value: "A" },
                        { type: "D", value: 0 },
                        { type: "D", value: 0 },
                        { type: "D", value: 0 }
                      ],
                      children: []
                    },
                    {
                      name: "P",
                      properties: [
                        { type: "S", value: "Lcl Rotation" },
                        { type: "S", value: "Lcl Rotation" },
                        { type: "S", value: "" },
                        { type: "S", value: "A" },
                        { type: "D", value: 0 },
                        { type: "D", value: 0 },
                        { type: "D", value: 0 }
                      ],
                      children: []
                    },
                    {
                      name: "P",
                      properties: [
                        { type: "S", value: "Lcl Scaling" },
                        { type: "S", value: "Lcl Scaling" },
                        { type: "S", value: "" },
                        { type: "S", value: "A" },
                        { type: "D", value: 1 },
                        { type: "D", value: 1 },
                        { type: "D", value: 1 }
                      ],
                      children: []
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          name: "Connections",
          properties: [],
          children: [
            {
              name: "C",
              properties: [
                { type: "S", value: "OO" },
                { type: "L", value: geomId },
                { type: "L", value: modelId }
              ],
              children: []
            },
            {
              name: "C",
              properties: [
                { type: "S", value: "OO" },
                { type: "L", value: modelId },
                { type: "L", value: 0 }
              ],
              children: []
            }
          ]
        }
      ];

      const writer = new ByteWriter();
      writer.writeBytes(new TextEncoder().encode("Kaydara FBX Binary  "));
      writer.writeUint8(0x00);
      writer.writeUint8(0x1a);
      writer.writeUint8(0x00);
      writer.writeUint32(7400);

      let offset = writer.length;
      for (let i = 0; i < nodes.length; i += 1) {
        const nodeBytes = buildNodeBytes(nodes[i], offset);
        writer.writeBytes(nodeBytes);
        offset += nodeBytes.length;
      }

      writer.writeZeros(13);
      writer.writeZeros(16);
      writer.writeUint32(7400);
      writer.writeZeros(120);
      writer.writeBytes(new TextEncoder().encode("Kaydara FBX Binary  "));
      writer.writeUint8(0x00);
      writer.writeUint8(0x1a);
      writer.writeUint8(0x00);

      onDone(writer.toUint8Array().buffer);
    } catch (error) {
      if (onError) {
        onError(error);
        return;
      }
      throw error;
    }
  }
}

window.FBXExporter = FBXExporter;
