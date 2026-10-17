"""Write a copy of a .pptx that keeps only some slides (the source is not changed).

Usage: python3 tools/split_deck.py SOURCE.pptx FIRST LAST OUT.pptx   (1-based, inclusive)
"""
import sys
from pathlib import Path

from pptx import Presentation


def split(source: Path, first: int, last: int, out: Path) -> int:
    deck = Presentation(str(source))
    id_list = deck.slides._sldIdLst
    entries = list(id_list)
    if not (1 <= first <= last <= len(entries)):
        raise ValueError(f"range {first}-{last} is outside 1-{len(entries)}")
    for index, entry in enumerate(entries, start=1):
        if not (first <= index <= last):
            id_list.remove(entry)
    deck.save(str(out))
    return last - first + 1


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    count = split(Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4]))
    print(f"wrote {count} slides to {sys.argv[4]}")
