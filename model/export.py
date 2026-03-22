"""
export_onnx.py — Export trained DQN to ONNX for browser inference

Usage:
    python export_onnx.py                                  # uses dqn_goldrush_final.pt
    python export_onnx.py --checkpoint dqn_goldrush_10000.pt
    python export_onnx.py --output model.onnx
"""

import argparse
import torch
import torch.nn as nn

from gold_rush_env import MAX_ASSETS

N_ACTIONS = 1 + 2 * MAX_ASSETS
GRID_CHANNELS = 6
SCALAR_DIM = 8
ASSET_FEATURES = 14


class DQN(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(GRID_CHANNELS, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(4),
        )
        self.asset_mlp = nn.Sequential(
            nn.Linear(ASSET_FEATURES, 32),
            nn.ReLU(),
            nn.Linear(32, 32),
            nn.ReLU(),
        )
        asset_pool_dim = 64
        combined_dim = 64 * 4 * 4 + asset_pool_dim + SCALAR_DIM
        self.fc = nn.Sequential(
            nn.Linear(combined_dim, 256),
            nn.ReLU(),
            nn.Linear(256, N_ACTIONS),
        )

    def forward(self, grid, scalars, asset_table):
        g = self.conv(grid).flatten(1)
        a = self.asset_mlp(asset_table)
        a_max = a.max(dim=1).values
        a_mean = a.mean(dim=1)
        a_pool = torch.cat([a_max, a_mean], dim=1)
        x = torch.cat([g, a_pool, scalars], dim=1)
        return self.fc(x)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default="dqn_goldrush_final.pt")
    parser.add_argument("--output", default="gold_rush_dqn.onnx")
    args = parser.parse_args()

    model = DQN()
    model.load_state_dict(torch.load(args.checkpoint, map_location="cpu", weights_only=True))
    model.eval()

    dummy_grid = torch.randn(1, GRID_CHANNELS, 20, 20)
    dummy_scalars = torch.randn(1, SCALAR_DIM)
    dummy_assets = torch.randn(1, MAX_ASSETS, ASSET_FEATURES)

    torch.onnx.export(
        model,
        (dummy_grid, dummy_scalars, dummy_assets),
        args.output,
        input_names=["grid", "scalars", "asset_table"],
        output_names=["q_values"],
        dynamic_axes={
            "grid": {0: "batch"},
            "scalars": {0: "batch"},
            "asset_table": {0: "batch"},
            "q_values": {0: "batch"},
        },
        opset_version=17,
    )
    print(f"Exported to {args.output}")
    print(f"Inputs: grid(1,6,20,20), scalars(1,8), asset_table(1,30,14)")
    print(f"Output: q_values(1,61)")


if __name__ == "__main__":
    main()