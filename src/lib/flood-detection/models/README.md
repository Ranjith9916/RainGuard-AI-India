# Flood-detection ONNX models

This directory holds the ONNX model weights used by the SAR flood inferencer.

## Expected files

- `etci_unet_sar.onnx` — ETCI 2020 U-Net trained on Sentinel-1 SAR patches
  for flood segmentation. The model expects a 3-channel (VV, VH, VV/VH)
  normalised input at 256x256 and outputs a binary mask of the same
  resolution.

## Source

The training pipeline is upstream at:
https://github.com/cloudtostreet/Sentinel-1-ETCI-2021

The model is NOT bundled in the baseline build (license / size
considerations). When absent, `ETCIUnetInferencer` falls back to the
threshold baseline and tags the result accordingly — see
`@/lib/adapters/flood-model/flood-inferencer.ts`.
