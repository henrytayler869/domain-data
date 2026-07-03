"""CLI: python -m pipeline <step> [options]. Mỗi module = 1 sub-command."""
from __future__ import annotations

import typer

from .ccrank import app as ccrank_app
from .dataforseo import app as dfs_app
from .drops import app as drops_app
from .filtering import app as filter_app
from .push import app as push_app
from .score import app as score_app
from .wayback import app as wayback_app
from .wpl import app as wpl_app

app = typer.Typer(
    help="Expired Domain Pipeline — lọc domain drop bằng dữ liệu công khai miễn phí.",
    no_args_is_help=True,
)
app.add_typer(wpl_app, name="wpl")            # Phase 1
app.add_typer(drops_app, name="drops")        # Phase 2
app.add_typer(wayback_app, name="wayback")    # Phase 3
app.add_typer(ccrank_app, name="ccrank")      # Phase 4
app.add_typer(filter_app, name="filter")      # Phase 5
app.add_typer(dfs_app, name="dataforseo")     # Phase 6
app.add_typer(score_app, name="score")        # Phase 7
app.add_typer(push_app, name="push")          # Phase 8 — đẩy lên Supabase (Domain Drop)

if __name__ == "__main__":
    app()
