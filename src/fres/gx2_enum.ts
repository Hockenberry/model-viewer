
export enum GX2SurfaceFormat {
    FLAG_SRGB   = 0x0400,
    FLAG_SNORM  = 0x0200,
    FMT_MASK    = 0x003F,
    FMT_BC1     = 0x0031,
    FMT_BC3     = 0x0033,
    FMT_BC4     = 0x0034,
    FMT_BC5     = 0x0035,

    FMT_TCS_R8_G8_B8_A8 = 0x1a,

    BC1_UNORM   = FMT_BC1,
    BC1_SRGB    = FMT_BC1 | FLAG_SRGB,
    BC3_UNORM   = FMT_BC3,
    BC3_SRGB    = FMT_BC3 | FLAG_SRGB,
    BC4_UNORM   = FMT_BC4,
    BC4_SNORM   = FMT_BC4 | FLAG_SNORM,
    BC5_UNORM   = FMT_BC5,
    BC5_SNORM   = FMT_BC5 | FLAG_SNORM,

    TCS_R8_G8_B8_A8_UNORM = FMT_TCS_R8_G8_B8_A8,
    TCS_R8_G8_B8_A8_SRGB  = FMT_TCS_R8_G8_B8_A8 | FLAG_SRGB,
}

export enum GX2TileMode {
    _1D_TILED_THIN1 = 0x02,
    _2D_TILED_THIN1 = 0x04,
}

export enum GX2AAMode {
    _1X = 0x00,
    _2X = 0x01,
    _4X = 0x02,
    _8X = 0x03,
}

export enum GX2PrimitiveType {
    TRIANGLES = 0x04,
}

export enum GX2IndexFormat {
    U16_LE = 0x00,
    U32_LE = 0x01,
    U16    = 0x02,
    U32    = 0x03,
}

export enum GX2AttribFormat {
    _8_UNORM = 0x0000,
    _8_UINT  = 0x0100,
    _8_SNORM = 0x0200,
    _8_SINT  = 0x0300,
}