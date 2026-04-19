/* ===== Internationalization ===== */
const translations = {
    fr: {
        // Nav
        nav_home: "Accueil",
        nav_concepts: "Concepts",
        nav_what: "C'est quoi ?",
        nav_anatomy: "Anatomie",
        nav_live: "Modification Live",
        nav_animations: "Animations",
        nav_bezier: "Courbes de Bezier",
        nav_gallery: "Galerie",
        nav_workshop: "Atelier",
        // Workshop
        workshop_title: "Atelier SVG",
        workshop_subtitle: "Choisissez une illustration et modifiez ses variables CSS en direct",
        workshop_how_title: "Comment ca marche",
        workshop_how_desc: "Chaque SVG de la galerie expose ses parametres sous forme de variables CSS dans une regle <code>:root</code>. L'atelier les detecte et genere les controles correspondants. Vos modifications sont sauvegardees dans le navigateur.",
        workshop_controls: "Controles",
        workshop_reset: "Reinitialiser",
        workshop_empty: "Ce SVG n'expose aucune variable.",
        workshop_view_svg: "SVG",
        workshop_view_compare: "Comparer",
        workshop_view_photo: "Photo",
        workshop_download: "Telecharger",
        // Footer
        footer_made: "Fait par",
        // Home
        home_title: "Formation SVG",
        home_subtitle: "Decouvrez la puissance du SVG pour le web",
        home_pitch_title: "Le SVG, un outil sous-estime",
        home_pitch: `Le SVG est un outil precieux pour n'importe quel developpeur web. <a class="inline-link" href="what-is-svg.html">Optimise pour toutes les tailles d'ecran</a>, il offre une puissance et une elegance pixel-perfect. Mais pas seulement : d'une <a class="inline-link" href="live-demo.html">flexibilite incomparable</a>, il est capable de s'adapter a vos utilisateurs avec un <a class="inline-link" href="animations.html">minimum de JavaScript</a>.`,
        home_problem_title: "Seul probleme...",
        home_problem: `Sa complexite peut effrayer (jetez un oeil a <a class="inline-link" href="svg-anatomy.html">l'anatomie d'un path</a> ou aux <a class="inline-link" href="bezier.html">courbes de Bezier</a>) :`,
        home_solution: `Cette suite peut sembler abstraite pour un humain, mais heureusement, pas pour une IA — explorez <a class="inline-link" href="workshop.html">l'atelier</a> ou <a class="inline-link" href="gallery.html">la galerie</a> !`,
        home_cta: "Venez decouvrir ou redecouvrir ce format d'image, dans une courte presentation avec de multiples exemples, dont certains generes en live !",
        home_start: "Commencer l'exploration",
        home_concepts_pitch: "Tu preferes une vue d'ensemble avant de plonger ? Jette un oeil a la carte des concepts.",
        home_concepts_cta: "Voir la carte des concepts",
        // Concepts page
        concepts_title: "Carte des concepts",
        concepts_subtitle: "Une vue d'ensemble du parcours, chapitre par chapitre",
        concepts_explore: "Explorer",
        concepts_intro: "Chaque carte mene a la page qui developpe le sujet. Tu peux y aller dans l'ordre, ou piocher selon ce qui t'intrigue.",
        concepts_what_desc: "Vectoriel vs matriciel, et pourquoi ca change tout au zoom.",
        concepts_anatomy_desc: "ViewBox, formes primitives, balise <path>, stylisation.",
        concepts_live_desc: "Tweaker remplissage, contour, rotation et voir le code mis a jour.",
        concepts_anim_desc: "CSS keyframes, SMIL, stroke-dashoffset, morphing de path.",
        concepts_bezier_desc: "Quadratiques, cubiques, points de controle a glisser.",
        concepts_workshop_desc: "SVGs parametriques avec controles live (couleurs, tailles, modes).",
        concepts_gallery_desc: "Exemples : fleurs, os pas-a-pas, generations IA, aide-memoires.",
        concepts_cta_what: "Decouvrir \u2192",
        concepts_cta_anatomy: "Demonter \u2192",
        concepts_cta_live: "Essayer \u2192",
        concepts_cta_anim: "Animer \u2192",
        concepts_cta_bezier: "Plier \u2192",
        concepts_cta_workshop: "Bricoler \u2192",
        concepts_cta_gallery: "Feuilleter \u2192",
        // What is SVG
        what_title: "C'est quoi, un SVG ?",
        what_subtitle: "Comprendre la difference entre images vectorielles et matricielles",
        what_vector_title: "Image Vectorielle (SVG)",
        what_raster_title: "Image Matricielle (PNG/JPG)",
        what_zoom: "Zoomez pour voir la difference !",
        what_vector_desc: "Definie par des formules mathematiques. Chaque forme est decrite par des equations, ce qui permet un redimensionnement infini sans perte de qualite.",
        what_raster_desc: "Composee d'une grille de pixels. Chaque pixel a une couleur fixe. En zoomant, les pixels deviennent visibles et l'image parait floue.",
        what_advantages_title: "Avantages du SVG",
        what_adv1: "Scalable a l'infini sans perte de qualite",
        what_adv2: "Fichiers legers pour les formes simples",
        what_adv3: "Modifiable par CSS et JavaScript",
        what_adv4: "Animable nativement",
        what_adv5: "Accessible (texte indexable par les moteurs de recherche)",
        what_adv6: "Ideal pour les icones, logos, illustrations",
        what_when_title: "Quand utiliser le SVG ?",
        what_when_svg: "SVG : icones, logos, illustrations, graphiques, animations",
        what_when_raster: "PNG/JPG : photos, images complexes avec beaucoup de couleurs",
        what_ai_title: "Pourquoi le SVG plait a l'IA",
        what_ai_p1: "Un SVG, c'est du texte. Du XML lisible, structure, avec des noms d'attributs explicites (cx, fill, d...). Pour un grand modele de langage, c'est exactement le terrain ou il excelle : il manipule des tokens, pas des pixels.",
        what_ai_p2: `La meme image en PNG ne serait qu'un tableau opaque de pixels. Une IA peut <em>reconnaitre</em> ce qu'elle voit, mais ne peut pas la modifier de maniere precise. En SVG, elle peut ajouter une forme, changer une couleur, ajuster une <a class="inline-link" href="bezier.html">courbe</a>, ou meme generer toute l'image a partir d'une description.`,
        what_ai_p3: `Toutes les illustrations IA de la <a class="inline-link" href="gallery.html">galerie</a> ont ete produites de cette facon : un prompt, une reponse en texte SVG, directement utilisable dans le navigateur.`,
        // Anatomy
        anat_title: "Anatomie d'un SVG",
        anat_subtitle: "Comprendre la structure du code SVG",
        anat_structure_title: "Structure de base",
        anat_structure_desc: "Un SVG est un document XML avec un element racine <svg> et des elements enfants qui decrivent les formes.",
        anat_viewbox_title: "Le ViewBox",
        anat_viewbox_desc: "L'attribut viewBox definit le systeme de coordonnees interne du SVG. Il permet de creer des graphiques responsifs qui s'adaptent a n'importe quelle taille.",
        anat_shapes_title: "Formes de base",
        anat_shapes_desc: "SVG offre plusieurs formes primitives pour construire vos graphiques.",
        anat_path_title: "La balise Path",
        anat_path_desc: "L'element <path> est le plus puissant du SVG. Il peut dessiner n'importe quelle forme avec des commandes de deplacement.",
        anat_path_commands: `Commandes principales : M (deplacer), L (ligne), H (horizontal), V (vertical), <a class="inline-link" href="bezier.html">C (courbe cubique), Q (courbe quadratique)</a>, A (arc), Z (fermer)`,
        anat_path_ai: `<i class="fa-solid fa-robot" style="color:#9b59b6; margin-right:0.4rem;"></i><strong>Cote IA :</strong> ces commandes (<code>M</code>, <code>C</code>, <code>Q</code>, <code>L</code>...) sont exactement ce qu'un LLM ecrit quand on lui demande de dessiner. Une fleur, un coeur, un logo : tout devient une chaine de caracteres comme <code>d="M30,45 C30,45 10,30 10,18..."</code>. Pour aller plus loin, voir les <a class="inline-link" href="bezier.html">courbes de Bezier</a>.`,
        anat_styling_title: "Stylisation",
        anat_styling_desc: `Les elements SVG peuvent etre styles avec des attributs, du CSS inline, ou des feuilles de style externes. Combine avec des <strong>variables CSS</strong>, le meme SVG devient parametrable a la volee — c'est exactement ce que fait <a class="inline-link" href="workshop.html">l'atelier</a>.`,
        anat_cheatsheet: "Aide-memoire complet",
        // Live demo
        live_title: "Modification en direct",
        live_subtitle: "Modifiez les attributs SVG et voyez le resultat instantanement",
        live_shape_title: "Forme interactive",
        live_shape_desc: "Utilisez les controles ci-dessous pour modifier les proprietes de cette forme SVG en temps reel.",
        live_code_title: "Code genere",
        live_code_desc: "Le code SVG se met a jour automatiquement lorsque vous modifiez les controles.",
        live_fill: "Remplissage",
        live_stroke: "Contour",
        live_strokew: "Epaisseur",
        live_opacity: "Opacite",
        live_rotation: "Rotation",
        live_scale: "Echelle",
        live_radius: "Rayon",
        live_sides: "Cotes",
        live_shape: "Forme",
        live_circle: "Cercle",
        live_rect: "Rectangle",
        live_polygon: "Polygone",
        live_star: "Etoile",
        live_reuse_desc: `Un SVG peut definir des elements reutilisables avec <code>&lt;defs&gt;</code> et <code>&lt;use&gt;</code>. Combinez cela avec des variables CSS pour creer des composants personnalisables.`,
        live_reuse_ai: `<i class="fa-solid fa-robot" style="color:#9b59b6; margin-right:0.4rem;"></i><strong>Le pattern d'une app IA :</strong> ce que tu vois ici est exactement la recette qu'on retrouve dans une application augmentee a l'IA : un <em>template</em> SVG (l'os, sa forme) plus des <em>parametres</em> (couleurs, texte) qui peuvent venir d'un humain... ou d'un LLM. <a class="inline-link" href="workshop.html">L'atelier</a> pousse l'idee plus loin avec une galerie complete de SVGs parametriques.`,
        // Animations
        anim_title: "Animations SVG",
        anim_subtitle: "Decouvrez les differentes techniques d'animation SVG",
        anim_css_title: "Animation CSS",
        anim_css_desc: "Les elements SVG peuvent etre animes avec les @keyframes CSS, comme n'importe quel element HTML.",
        anim_smil_title: "Animation SMIL",
        anim_smil_desc: "SMIL (Synchronized Multimedia Integration Language) permet d'animer directement dans le SVG avec des balises comme <animate>.",
        anim_stroke_title: "Animation de trait",
        anim_stroke_desc: "L'animation stroke-dashoffset permet de creer un effet de dessin progressif.",
        anim_morph_title: "Morphing de forme",
        anim_morph_desc: "En animant l'attribut 'd' d'un path, on peut transformer une forme en une autre.",
        anim_transform_title: "Transformations",
        anim_transform_desc: "Les transformations SVG (rotation, scale, translate) peuvent etre animees pour creer des effets dynamiques.",
        anim_interactive_title: "Animation interactive",
        anim_interactive_desc: "Combinez SVG et JavaScript pour creer des animations qui reagissent aux actions de l'utilisateur.",
        // Bezier
        bez_title: "Courbes de Bezier",
        bez_subtitle: "Explorez les courbes cubiques et quadratiques de maniere interactive",
        bez_quad_title: "Courbe quadratique (Q)",
        bez_quad_desc: "Definie par un point de depart, un point de controle et un point d'arrivee. La courbe est attiree vers le point de controle.",
        bez_cubic_title: "Courbe cubique (C)",
        bez_cubic_desc: "Definie par un point de depart, deux points de controle et un point d'arrivee. Offre plus de precision que la quadratique.",
        bez_drag: "Glissez les points de controle pour modifier la courbe !",
        bez_command: "Commande SVG :",
        bez_ai_title: "Une courbe ecrite par une IA",
        bez_ai_desc: `Voici la fleur en cloche d'une heather, dessinee par Claude. Toute la corolle est un seul <code>&lt;path&gt;</code> compose de <strong>commandes Q (quadratiques)</strong> chainees — exactement ce que tu as appris a manipuler plus haut.`,
        bez_ai_takeaway: `Chaque <code>Q</code> = un point de controle + un point d'arrivee. Sept commandes, une fleur. C'est ca qui rend les SVGs si interessants pour l'IA : <strong>sortie courte, structure claire, modifiable a la main</strong>. Tu pourrais ouvrir ce fichier et changer une couleur, deplacer un petale, ou ajouter une etamine — sans regenerer quoi que ce soit. Voir d'autres exemples dans la <a class="inline-link" href="gallery.html">galerie</a>.`,
        // Gallery
        gal_title: "Galerie SVG",
        gal_subtitle: "Une collection d'exemples SVG, des fleurs aux os en passant par l'IA",
        gal_tab_all: "Tout",
        gal_tab_flowers: "Fleurs",
        gal_tab_bones: "Os (etape par etape)",
        gal_tab_ai: "Genere par IA",
        gal_tab_cheatsheets: "Aide-memoires",
        gal_prompt: "Prompt :",
        gal_prompt_placeholder: "Le prompt sera ajoute prochainement",
        gal_techniques: `Les exemples ci-dessous combinent des techniques vues ailleurs dans le parcours : <a class="inline-link" href="svg-anatomy.html">anatomie</a> et formes de base, <a class="inline-link" href="bezier.html">courbes de Bezier</a> pour les paths, <a class="inline-link" href="animations.html">animations</a> pour le mouvement, et <a class="inline-link" href="live-demo.html">defs/use + variables CSS</a> pour les composants reutilisables comme l'os ci-dessous.`,
        gal_bone_techniques: `Chaque etape ajoute une technique : <a class="inline-link" href="svg-anatomy.html">viewBox</a>, transforms, gradients, filters. Le passage d'icone plate a os 3D illustre comment quelques attributs SVG bien choisis suffisent a creer de la profondeur.`,
    },
    en: {
        nav_home: "Home",
        nav_concepts: "Concepts",
        nav_what: "What is it?",
        nav_anatomy: "Anatomy",
        nav_live: "Live Editing",
        nav_animations: "Animations",
        nav_bezier: "Bezier Curves",
        nav_gallery: "Gallery",
        nav_workshop: "Workshop",
        workshop_title: "SVG Workshop",
        workshop_subtitle: "Pick an illustration and tweak its CSS variables in real time",
        workshop_how_title: "How it works",
        workshop_how_desc: "Each gallery SVG exposes its parameters as CSS variables inside a <code>:root</code> rule. The workshop detects them and builds the matching controls. Your edits are persisted in your browser.",
        workshop_controls: "Controls",
        workshop_reset: "Reset",
        workshop_empty: "This SVG does not expose any variables.",
        workshop_view_svg: "SVG",
        workshop_view_compare: "Compare",
        workshop_view_photo: "Photo",
        workshop_download: "Download",
        footer_made: "Made by",
        home_title: "SVG Workshop",
        home_subtitle: "Discover the power of SVG for the web",
        home_pitch_title: "SVG, an underrated tool",
        home_pitch: `SVG is an invaluable tool for any web developer. <a class="inline-link" href="what-is-svg.html">Optimized for all screen sizes</a>, it offers pixel-perfect power and elegance. But that's not all: with <a class="inline-link" href="live-demo.html">unmatched flexibility</a>, it can adapt to your users with <a class="inline-link" href="animations.html">minimal JavaScript</a>.`,
        home_problem_title: "The only problem...",
        home_problem: `Its complexity can be intimidating (have a look at <a class="inline-link" href="svg-anatomy.html">the anatomy of a path</a> or <a class="inline-link" href="bezier.html">Bezier curves</a>):`,
        home_solution: `This sequence may seem abstract to a human, but fortunately, not to an AI — explore <a class="inline-link" href="workshop.html">the workshop</a> or <a class="inline-link" href="gallery.html">the gallery</a>!`,
        home_cta: "Come discover or rediscover this image format, in a short presentation with multiple examples, some generated live!",
        home_start: "Start exploring",
        home_concepts_pitch: "Want a bird's-eye view before diving in? Take a look at the concepts map.",
        home_concepts_cta: "See the concepts map",
        concepts_title: "Concepts map",
        concepts_subtitle: "A bird's-eye view of the journey, chapter by chapter",
        concepts_explore: "Explore",
        concepts_intro: "Each card leads to the page that goes deeper. Walk it in order, or jump to whatever sparks your curiosity.",
        concepts_what_desc: "Vector vs raster, and why it changes everything at zoom.",
        concepts_anatomy_desc: "ViewBox, primitive shapes, the <path> element, styling.",
        concepts_live_desc: "Tweak fill, stroke, rotation and watch the code update.",
        concepts_anim_desc: "CSS keyframes, SMIL, stroke-dashoffset, path morphing.",
        concepts_bezier_desc: "Quadratics, cubics, draggable control points.",
        concepts_workshop_desc: "Parametric SVGs with live controls (colors, sizes, modes).",
        concepts_gallery_desc: "Examples: flowers, step-by-step bones, AI generations, cheat sheets.",
        concepts_cta_what: "Discover \u2192",
        concepts_cta_anatomy: "Take apart \u2192",
        concepts_cta_live: "Try it \u2192",
        concepts_cta_anim: "Animate \u2192",
        concepts_cta_bezier: "Bend it \u2192",
        concepts_cta_workshop: "Tinker \u2192",
        concepts_cta_gallery: "Browse \u2192",
        what_title: "What is an SVG?",
        what_subtitle: "Understanding the difference between vector and raster images",
        what_vector_title: "Vector Image (SVG)",
        what_raster_title: "Raster Image (PNG/JPG)",
        what_zoom: "Zoom in to see the difference!",
        what_vector_desc: "Defined by mathematical formulas. Each shape is described by equations, allowing infinite resizing without quality loss.",
        what_raster_desc: "Composed of a grid of pixels. Each pixel has a fixed color. When zooming, pixels become visible and the image appears blurry.",
        what_advantages_title: "SVG Advantages",
        what_adv1: "Infinitely scalable without quality loss",
        what_adv2: "Lightweight files for simple shapes",
        what_adv3: "Modifiable via CSS and JavaScript",
        what_adv4: "Natively animatable",
        what_adv5: "Accessible (text indexable by search engines)",
        what_adv6: "Ideal for icons, logos, illustrations",
        what_when_title: "When to use SVG?",
        what_when_svg: "SVG: icons, logos, illustrations, charts, animations",
        what_when_raster: "PNG/JPG: photos, complex images with many colors",
        what_ai_title: "Why AI loves SVG",
        what_ai_p1: "An SVG is just text. Readable, structured XML with self-explanatory attribute names (cx, fill, d...). For a large language model, that's exactly its home turf: it manipulates tokens, not pixels.",
        what_ai_p2: `The same image as PNG would be an opaque grid of pixels. An AI can <em>recognize</em> what it sees, but it can't precisely modify it. With SVG, it can add a shape, change a color, adjust a <a class="inline-link" href="bezier.html">curve</a>, or even generate the whole image from a description.`,
        what_ai_p3: `Every AI illustration in the <a class="inline-link" href="gallery.html">gallery</a> was produced this way: a prompt, a text SVG response, ready to drop into the browser.`,
        anat_title: "Anatomy of an SVG",
        anat_subtitle: "Understanding SVG code structure",
        anat_structure_title: "Basic structure",
        anat_structure_desc: "An SVG is an XML document with a root <svg> element and child elements that describe shapes.",
        anat_viewbox_title: "The ViewBox",
        anat_viewbox_desc: "The viewBox attribute defines the SVG's internal coordinate system. It enables responsive graphics that adapt to any size.",
        anat_shapes_title: "Basic shapes",
        anat_shapes_desc: "SVG provides several primitive shapes to build your graphics.",
        anat_path_title: "The Path element",
        anat_path_desc: "The <path> element is the most powerful in SVG. It can draw any shape using movement commands.",
        anat_path_commands: `Main commands: M (move), L (line), H (horizontal), V (vertical), <a class="inline-link" href="bezier.html">C (cubic curve), Q (quadratic curve)</a>, A (arc), Z (close)`,
        anat_path_ai: `<i class="fa-solid fa-robot" style="color:#9b59b6; margin-right:0.4rem;"></i><strong>AI angle:</strong> these commands (<code>M</code>, <code>C</code>, <code>Q</code>, <code>L</code>...) are exactly what an LLM types when you ask it to draw. A flower, a heart, a logo: each becomes a string like <code>d="M30,45 C30,45 10,30 10,18..."</code>. To dive deeper, see <a class="inline-link" href="bezier.html">Bezier curves</a>.`,
        anat_styling_title: "Styling",
        anat_styling_desc: `SVG elements can be styled with attributes, inline CSS, or external stylesheets. Combined with <strong>CSS variables</strong>, the same SVG becomes parametric on the fly — which is exactly what <a class="inline-link" href="workshop.html">the workshop</a> does.`,
        anat_cheatsheet: "Complete cheat sheet",
        live_title: "Live Editing",
        live_subtitle: "Modify SVG attributes and see the result instantly",
        live_shape_title: "Interactive Shape",
        live_shape_desc: "Use the controls below to modify this SVG shape's properties in real time.",
        live_code_title: "Generated Code",
        live_code_desc: "The SVG code updates automatically as you change the controls.",
        live_fill: "Fill",
        live_stroke: "Stroke",
        live_strokew: "Width",
        live_opacity: "Opacity",
        live_rotation: "Rotation",
        live_scale: "Scale",
        live_radius: "Radius",
        live_sides: "Sides",
        live_shape: "Shape",
        live_circle: "Circle",
        live_rect: "Rectangle",
        live_polygon: "Polygon",
        live_star: "Star",
        live_reuse_desc: `An SVG can define reusable elements with <code>&lt;defs&gt;</code> and <code>&lt;use&gt;</code>. Combine that with CSS variables to build customizable components.`,
        live_reuse_ai: `<i class="fa-solid fa-robot" style="color:#9b59b6; margin-right:0.4rem;"></i><strong>The AI app pattern:</strong> what you see here is exactly the recipe behind any AI-augmented app: an SVG <em>template</em> (the bone, its shape) plus <em>parameters</em> (colors, text) that can come from a human... or from an LLM. <a class="inline-link" href="workshop.html">The workshop</a> takes the idea further with a full gallery of parametric SVGs.`,
        anim_title: "SVG Animations",
        anim_subtitle: "Discover the different SVG animation techniques",
        anim_css_title: "CSS Animation",
        anim_css_desc: "SVG elements can be animated with CSS @keyframes, just like any HTML element.",
        anim_smil_title: "SMIL Animation",
        anim_smil_desc: "SMIL (Synchronized Multimedia Integration Language) lets you animate directly within SVG using tags like <animate>.",
        anim_stroke_title: "Stroke Animation",
        anim_stroke_desc: "The stroke-dashoffset animation creates a progressive drawing effect.",
        anim_morph_title: "Shape Morphing",
        anim_morph_desc: "By animating a path's 'd' attribute, you can transform one shape into another.",
        anim_transform_title: "Transformations",
        anim_transform_desc: "SVG transforms (rotation, scale, translate) can be animated for dynamic effects.",
        anim_interactive_title: "Interactive Animation",
        anim_interactive_desc: "Combine SVG and JavaScript to create animations that react to user actions.",
        bez_title: "Bezier Curves",
        bez_subtitle: "Explore cubic and quadratic curves interactively",
        bez_quad_title: "Quadratic curve (Q)",
        bez_quad_desc: "Defined by a start point, a control point and an end point. The curve is pulled toward the control point.",
        bez_cubic_title: "Cubic curve (C)",
        bez_cubic_desc: "Defined by a start point, two control points and an end point. Offers more precision than quadratic.",
        bez_drag: "Drag the control points to modify the curve!",
        bez_command: "SVG command:",
        bez_ai_title: "A curve written by an AI",
        bez_ai_desc: `Here's a heather's bell-shaped flower, drawn by Claude. The whole corolla is a single <code>&lt;path&gt;</code> made of chained <strong>Q (quadratic) commands</strong> — exactly what you just learned to manipulate above.`,
        bez_ai_takeaway: `Each <code>Q</code> = one control point + one endpoint. Seven commands, one flower. That's what makes SVG so interesting for AI: <strong>short output, clear structure, hand-editable</strong>. You could open this file and change a color, move a petal, or add a stamen — without regenerating anything. More examples in the <a class="inline-link" href="gallery.html">gallery</a>.`,
        gal_title: "SVG Gallery",
        gal_subtitle: "A collection of SVG examples, from flowers to bones to AI-generated art",
        gal_tab_all: "All",
        gal_tab_flowers: "Flowers",
        gal_tab_bones: "Bones (step by step)",
        gal_tab_ai: "AI Generated",
        gal_tab_cheatsheets: "Cheat Sheets",
        gal_prompt: "Prompt:",
        gal_prompt_placeholder: "Prompt coming soon",
        gal_techniques: `The examples below combine techniques you've seen elsewhere on the journey: <a class="inline-link" href="svg-anatomy.html">anatomy</a> and basic shapes, <a class="inline-link" href="bezier.html">Bezier curves</a> for paths, <a class="inline-link" href="animations.html">animations</a> for motion, and <a class="inline-link" href="live-demo.html">defs/use + CSS variables</a> for reusable components like the bone below.`,
        gal_bone_techniques: `Each step adds a technique: <a class="inline-link" href="svg-anatomy.html">viewBox</a>, transforms, gradients, filters. The shift from flat icon to 3D bone shows how a few well-chosen SVG attributes are enough to build depth.`,
    }
};

let currentLang = 'fr';

function detectLanguage() {
    const saved = localStorage.getItem('svg-conf-lang');
    if (saved) return saved;
    const browserLang = navigator.language || navigator.userLanguage;
    return browserLang.startsWith('fr') ? 'fr' : 'en';
}

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('svg-conf-lang', lang);
    document.documentElement.lang = lang;
    translatePage();
    const btn = document.querySelector('.lang-toggle');
    if (btn) btn.textContent = lang === 'fr' ? 'EN' : 'FR';
}

function toggleLanguage() {
    setLanguage(currentLang === 'fr' ? 'en' : 'fr');
}

function t(key) {
    return translations[currentLang][key] || translations['en'][key] || key;
}

function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const text = t(key);
        if (text) el.textContent = text;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        const text = t(key);
        if (text) el.innerHTML = text;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const text = t(key);
        if (text) el.placeholder = text;
    });
}

/* ===== Header & Footer Loading ===== */
async function loadPartials() {
    try {
        const headerResp = await fetch('parts/header.html');
        if (headerResp.ok) {
            document.getElementById('header-placeholder').innerHTML = await headerResp.text();
        }
    } catch (e) { /* header already inline */ }

    try {
        const footerResp = await fetch('parts/footer.html');
        if (footerResp.ok) {
            document.getElementById('footer-placeholder').innerHTML = await footerResp.text();
        }
    } catch (e) { /* footer already inline */ }

    // Mark active nav link
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav a').forEach(a => {
        const href = a.getAttribute('href');
        if (href === currentPage || (currentPage === '' && href === 'index.html')) {
            a.classList.add('active');
        }
    });

    // Hamburger toggle
    const hamburger = document.querySelector('.hamburger');
    const nav = document.querySelector('nav');
    if (hamburger && nav) {
        hamburger.addEventListener('click', () => nav.classList.toggle('open'));
    }

    // Lang toggle
    const langBtn = document.querySelector('.lang-toggle');
    if (langBtn) langBtn.addEventListener('click', toggleLanguage);

    // Apply translations
    setLanguage(detectLanguage());
}

/* ===== Tabs ===== */
function initTabs() {
    document.querySelectorAll('.tabs').forEach(tabBar => {
        const buttons = tabBar.querySelectorAll('.tab-btn');
        const container = tabBar.parentElement;
        const contents = container.querySelectorAll('.tab-content');

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const target = container.querySelector(`#${btn.dataset.tab}`);
                if (target) target.classList.add('active');
            });
        });
    });
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', () => {
    loadPartials();
    initTabs();
});
