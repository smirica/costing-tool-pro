# Winding Sheet Reader - Azure Field Specification

Use this field list for the custom winding-sheet analyzer. All values are extracted unless marked **Calculated**. The **Loss Testing** section is intentionally omitted.

## Document identity and transformer specification

| Field name | Type | Description | Example |
|---|---|---|---|
| CatalogNumber | string | Catalog or part number printed on the winding sheet. | 21-1001L-U-1 |
| ItemDescription | string | Normalized check-and-balance description assembled from phase, kVA, frequency, voltages, connection/enclosure, and transformer type. | 1PH 10KVA 60 Hz 208V to 120V HOSPITAL ISOLATION TRANSFORMER |
| TransformerType | string | Product or transformer type from the matched master data or document. | HOSPITAL ISOLATION TRANSFORMER |
| CoilsPerTransformer | integer | Transformer-level coil count. If repeated on multiple pages, record once and do not add repeated values. | 2 |
| Phase | integer | Electrical phase count: 1 or 3. | 1 |
| KVA | number | Transformer kVA rating. | 10 |
| FrequencyHz | string | Rated frequency or frequency range. | 60 |
| EnclosureRating | string | Enclosure or NEMA rating when present. | TYPE 3R |
| PrimaryVoltage | string | Primary rated voltage, preserving connection notation. | 208V |
| Secondary1Voltage | string | First secondary rated voltage, preserving split-phase or connection notation. | 120V |
| Secondary2Voltage | string | Second secondary voltage when present. | |
| Secondary3Voltage | string | Third secondary voltage when present. | |
| DesignDate | date | Design date printed on the sheet. | 2024-10-30 |
| RevisionNumber | string | Current revision identifier. | 3 |
| RevisionDate | date | Current revision date. | 2026-04-27 |
| PageCount | integer | Number of pages in the winding-sheet document. | 1 |

## Windings

Create **Windings** as a repeating array of objects. Include primary, secondary, tertiary, and shield windings. Exclude blank columns and External Duct columns.

| Subfield | Type | Description | Example |
|---|---|---|---|
| WindingName | string | Winding label exactly as shown. | PRIMARY 1 |
| WindingRole | string | Normalized role: Primary, Secondary, Tertiary, Shield, or Other. | Primary |
| ColumnNumber | integer | One-based source column position. | 1 |
| BreakOut | string | Lead or terminal breakout designation. | 1-2 |
| NoLoadVoltage | string | No-load voltage string as printed. | 208.00 |
| FullLoadVoltage | string | Full-load voltage string as printed. | 208 |
| WireMaterial | string | Normalized conductor material, usually COPPER or ALUMINUM. | COPPER |
| WireInsulationClass | string | Wire insulation temperature/class. | 220°C |
| WireNumberOrSize | string | Full wire number, parallel count, or dimensional size. | 1 - 0.102 X 0.258 |
| WireDimensions | string | Finished conductor dimensions. | 0.112 X 0.268 |
| ConductorType | string | Normalized conductor geometry: Round, Rectangle, Foil, or Review. | Rectangle |
| Bifilar | string | Bifilar/multiple-in-hand notation. | 1H1W |
| CoilLengthInches | number | Coil length in inches. | 7.875 |
| MarginEachEndInches | number | Margin at each end in inches. | 0.375 |
| WindingLengthInches | number | Usable winding length in inches. | 7.125 |
| DuctStickSize | string | Duct stick dimension or designation. | 0.250 X 0.375 |
| TotalTurns | number | Total turns for the winding. | 46 |
| Taps | string | Tap details exactly as shown. | |
| TurnsPerLayer | string | Turns/layers notation from T / L rows. | 1L-25, 1L-21 |
| WireResistanceOhms | number | Wire resistance in ohms. | 0.01838 |
| WireWeightLbsPerCoil | number | Conductor weight for one coil before multiplying by coil count. | 6.02351 |
| TotalWireWeightLbs | number | **Calculated:** WireWeightLbsPerCoil × CoilsPerTransformer. | 12.04702 |
| Leads | string | Lead wire and lead length details. | (1,2)-Self-10" |
| SourcePage | integer | Page where the winding row was found. | 1 |
| Confidence | number | Analyzer confidence for this winding object. | 0.94 |

## Insulation, papers, tapes, tubes, and wraps

Create **InsulationItems** as a repeating array of objects.

| Subfield | Type | Description |
|---|---|---|
| ItemName | string | Material/type exactly as printed, such as NOMEX 410, CEQUIN IF, or GC155. |
| Category | string | Normalized category: Layer Paper, Tape, Tube, Wrap 1, Wrap 2, Shield Insulation, or Other. |
| WindingName | string | Winding to which the insulation item applies. |
| LayerCount | number | Number of layers when stated. |
| PieceCount | number | Number of pieces when stated. |
| ThicknessInches | number | Material thickness when stated. |
| WidthInches | number | Piece or material width when stated. |
| LengthInches | number | Piece or material length when stated. |
| QuantityText | string | Original quantity/dimension expression for auditability. |
| Confidence | number | Analyzer confidence for this item. |

## Steel, core, and construction

| Field name | Type | Description | Example |
|---|---|---|---|
| SteelGrade | string | Lamination/core steel grade. | M12 |
| SteelWeightLbs | number | Core/lamination steel weight in pounds. | 110 |
| LaminationThicknessInches | number | Lamination thickness. | 0.014 |
| StackInches | number | Core stack dimension. | 2.75 |
| LaminationDetails | string | Full LAM Details text for audit and fallback. | I'S 4" AS UI, 0.014THK M12, 2.75" STK... |
| TubeDetails | string | Full tube specification. | NO TUBE / NOMEX tube details |
| CoilfaceCrossoverMargin | string | Coilface crossover margin field. | NONE |
| WindingFinishingNotes | array | Ordered winding/finishing note strings. | |
| DrawingConnectionText | string | Connection labels/text from the winding diagram. | H1, H2, X1, X2 |
| SpecialReviewNotes | array | Parser/analyzer review warnings and exceptional conditions. | |

## Calculated material totals

| Field name | Type | Calculation |
|---|---|---|
| WindingCount | integer | Count valid Windings array rows; include shield, exclude blank and External Duct. |
| PaperTapeTypeCount | integer | Count unique normalized InsulationItems item names. |
| CopperWeightLbs | number | Sum copper WireWeightLbsPerCoil × CoilsPerTransformer. |
| AluminumWeightLbs | number | Sum aluminum WireWeightLbsPerCoil × CoilsPerTransformer. |
| SteelTotalWeightLbs | number | SteelWeightLbs. |
| TotalMetalWeightLbs | number | CopperWeightLbs + AluminumWeightLbs + SteelTotalWeightLbs. |
| TotalInsulationWeightLbs | number | Populate only when a reliable weight source or approved conversion exists; otherwise null. |
| TotalMaterialWeightLbs | number | Metal plus any reliably calculated insulation/material weights; never invent missing weights. |

## Item-description normalization rule

Preferred order: `{Phase}PH {KVA}KVA {FrequencyHz} Hz {PrimaryVoltage} to {Secondary1Voltage} {connection/split-phase text} {EnclosureRating} {TransformerType}`.

Master-data example: catalog `41-80-002GPV5` becomes `1PH 80KVA 60 Hz 480V to 240V SPLIT PHASE TYPE 3R SINGLE PHASE TRANSFORMER`.

## Validation rules

- Treat CoilsPerTransformer as one transformer-level value, even if repeated on every page.
- Preserve voltage connection notation such as Y, DELTA, CT, SPLIT PHASE, and 3P3W/3P4W.
- Do not infer a numeric value when the source shows a dash or is blank; return null and flag for review.
- Keep source text for unusual sizes, taps, leads, and notes.
- Normalize ALUMINIUM to ALUMINUM and CU/AL only when context is unambiguous.
- ItemDescription is a check-and-balance field and may be enriched from matched catalog master data.
- Loss-testing fields and calculations are excluded from this model.
