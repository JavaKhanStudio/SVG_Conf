"""One-shot: add data-i18n tags to gallery.html descriptions and
emit matching FR/EN entries for js/main.js.

Runs idempotently: if data-i18n is already there it's skipped.
"""
import re
from pathlib import Path

# (key, en_text, fr_text). en_text must match what's currently in gallery.html verbatim.
ENTRIES = [
    # Bone evolution captions (<p>)
    ("gallery_bone_v1",  "Base icon (16x16)",                  "Icone de base (16x16)"),
    ("gallery_bone_v2",  "+ rotation (transform)",             "+ rotation (transform)"),
    ("gallery_bone_v3",  "+ matrix transform + text",          "+ matrix transform + texte"),
    ("gallery_bone_v4",  "+ viewBox + layout",                 "+ viewBox + layout"),
    ("gallery_bone_v5",  "+ gradients + filters",              "+ gradients + filtres"),
    ("gallery_bone_v6",  "+ highlight gradient",               "+ gradient de reflet"),
    ("gallery_bone_v7",  "+ refinements",                      "+ ajustements"),
    ("gallery_bone_v8",  "+ shadow & depth",                   "+ ombre et profondeur"),
    ("gallery_bone_v9",  "+ texture pattern",                  "+ pattern de texture"),
    ("gallery_bone_v10", "+ edge effects",                     "+ effets de bord"),
    ("gallery_bone_v11", "+ text emboss filter",               "+ filtre emboss pour le texte"),
    ("gallery_bone_v12", "+ polished styling",                 "+ finitions"),
    ("gallery_bone_v13", "Final: full metallic bone",          "Final : os metallique complet"),
    # Flower cards
    ("gallery_blackthorn_desc",    "Prunellier - CSS variables, defs/use pattern", "Prunellier, variables CSS, pattern defs/use"),
    ("gallery_blackthornv2_desc",  "Variation with refined petals",                "Variation avec petales raffines"),
    ("gallery_rose_desc",          "Complex petal layering with gradients",        "Superposition de petales avec gradients"),
    ("gallery_daisy_desc",         "Symmetrical petal arrangement",                "Arrangement symetrique des petales"),
    ("gallery_bluebell_desc",      "Bell-shaped flower with curves",               "Fleur en cloche avec courbes"),
    ("gallery_pansy_desc",         "Multi-colored petals with detail",             "Petales multicolores detailles"),
    ("gallery_wildrose_desc",      "Progressive wild rose design",                 "Design progressif d'eglantine"),
    ("gallery_vine_desc",          "Curved stroke with depth layers",              "Trace courbe avec couches de profondeur"),
    # AI tab captions
    ("gallery_ai_claude",          "AI: Claude",                                   "IA : Claude"),
    ("gallery_ai_deepseek",        "AI: DeepSeek",                                 "IA : DeepSeek"),
    ("gallery_ai_gpt",             "AI: ChatGPT",                                  "IA : ChatGPT"),
    ("gallery_ai_gpt_bone",        "AI: ChatGPT - bone tag variant",               "IA : ChatGPT, variante dogtag"),
    # Tool cards
    ("gallery_tool_cheat",         "Shapes, paths, styling, transforms, filters", "Formes, paths, styling, transforms, filtres"),
    ("gallery_tool_bezier",        "Quadratic & cubic bezier reference",           "Reference beziers quadratiques et cubiques"),
    ("gallery_tool_rotation",      "Transform rotation demonstrations",            "Demonstrations de rotation et transform"),
    ("gallery_tool_3dtext",        "Advanced gradients for 3D text rendering",     "Gradients avances pour le rendu 3D de texte"),
    ("gallery_tool_patte",         "Simple reusable decorative element",           "Element decoratif simple et reutilisable"),
]

def main():
    p = Path("gallery.html")
    html = p.read_text(encoding="utf-8")
    # AI: "AI: Claude" appears multiple times — the multi-instance ones (AI: Claude x2,
    # AI: DeepSeek x2, AI: ChatGPT x2) we tag with replace_all; the _bone variant is unique.
    seen = {}
    for key, en, fr in ENTRIES:
        pat = f"<p>{re.escape(en)}</p>"
        repl = f'<p data-i18n="{key}">{en}</p>'
        new_html, n = re.subn(pat, repl, html)
        seen[key] = n
        html = new_html
    p.write_text(html, encoding="utf-8")
    print("Replacements per key:")
    for k, n in seen.items():
        print(f"  {k}: {n}")
    print()
    print("=== Append this to js/main.js fr block ===")
    for key, en, fr in ENTRIES:
        esc = fr.replace('"', '\\"')
        print(f'        {key}: "{esc}",')
    print()
    print("=== Append this to js/main.js en block ===")
    for key, en, fr in ENTRIES:
        esc = en.replace('"', '\\"')
        print(f'        {key}: "{esc}",')

if __name__ == "__main__":
    main()
