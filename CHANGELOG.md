# Changelog

All notable changes to Parchment are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* The layers and canvases library tabs now have a search box to filter the list by name.

### Changed

* The routing settings popup is more compact, and the routing engine picker only appears when there is more than one engine to choose from.

### Fixed

* The routing settings popup no longer overflows off screen — when its options are taller than the window, it caps at the visible height and scrolls inside.
* The layers library tab's add and store buttons no longer overlap the tab bar — they now sit at the top of the list, matching the routes tab.

## [0.9.0] - 2026-09-03

### Added

* The Transfers section shows where a connection leaves from and when. Each connecting station gets its own block under its name — tap it to open that station — with its lines and times beneath, laid out like the departures above. Stations sharing a name are one block, since that is the same station drawn twice.
* Each stop on a route's detail page shows the other lines you can get there, under its name — Union Square on the N listing Q and R and W beside it, and the 4, 5, 6 and L a passageway away. Lines reached by a transfer are dimmed, since they leave from another platform rather than the one you are standing on
* A station's Transfers section now also lists lines running from stops within walking distance — the bus from the stop outside a subway entrance. No transit feed can describe a connection between two different operators, so these are found by distance alone: they come after the connections the agency does publish, nearest first, and may well cost another fare
* The MapLibre engine can now draw the map on a globe. The map projection setting applies to both engines, offering flat and globe on MapLibre and the full list on Mapbox
* Canvases — your own maps, in a new tab of your library. A canvas is a stack of layers you assemble: imagery or data you style yourself, layers borrowed from your library, and collections of saved places drawn as points. Switch a canvas on and it draws over the basemap like anything else; open it and it takes over the panel beside the map so you can arrange it against the map itself
* A canvas is either shareable or private, and you can change your mind. A shareable one is stored so it can be published with a link one day; a private one is end-to-end encrypted, and only devices holding your recovery key can open it. Switching between them under Canvas details re-packages the whole canvas in one go — and making one private revokes any public link, since there would be nothing left for that link to show. A device that hasn't imported your recovery key can still make and edit shareable canvases
* A data sources browser for canvases. One half is a curated library of datasets that need no setup — time zones, OpenStreetMap and topographic tiles, elevation, railways, nautical charts — and picking one makes a layer you can restyle. The other half is your own file or a URL. Live database connections (Postgres, BigQuery, Snowflake) are listed but not built yet, and say so
* Bring your own data to a canvas. Drop in a GeoJSON, KML, GPX or CSV file — a CSV just needs latitude and longitude columns — and it lands as a layer, drawn the way its contents suggest: points as dots, tracks as lines, boundaries as filled shapes. Switch any of them to a heatmap, recolour them, resize them, or label each point from one of its own columns. Files are read on your device and stored inside the canvas, so a private canvas can hold imported data the server never sees
* Draw straight onto a canvas, with no layer involved. A toolbar sits over the map for as long as a canvas is open: pins, lines, routes, polygons, rectangles and circles, each on a single-key shortcut. The route tool snaps to the street network as you click, in walking, cycling or driving mode, using the same engine as directions. The shape follows your cursor as you draw — a rubber band to the next point, and rectangles and circles previewed at full size — and an open shape is finished by a double-click or by clicking back on the point you started from. A tool stays picked until you choose another or press Escape, so a run of pins is a run of clicks. Hold Shift to constrain what you are drawing: a line or an edge holds a round angle, a rectangle becomes a square, a circle takes a round radius. Rectangles take three clicks rather than two — a side, then its depth — so one can sit at any angle instead of square to the screen. Whatever you just drew opens for naming straight away, and every mark stays editable afterwards: drag any of its points to reshape it, drag the middle of an edge to add one, double-click a point to take it out, or rename it, recolour it, give a pin its own icon, or keep the name for your own list without printing it on the map — and when you do print it, choose which side of the mark it sits on and how big it is. Every mark can be styled properly: border width, border style — solid, dashed or dotted — border opacity, and for anything that encloses ground, its own fill colour and fill opacity separate from its outline. A pin gets a size. Only the settings that mean something for the shape in hand are offered, so a line is never asked about its fill. Reshaping a route sends it back through the routing engine, so it still follows the streets, and the shape crawls while the answer is on its way. Every mark carries its own measurements, worked out the same way the measure tool works them out — a line's length, a shape's area and perimeter, a circle's radius, circumference and area — with the headline figure beside its name in the list and the rest inside. The route tool is offered only when something is configured that can actually plan one. Marks you make are kept apart from data you brought — they always draw on top, and they're listed under the layer stack rather than in it
* Draw freehand on a canvas. Pick a stroke width, drag, and the line is tidied as you let go — the jitter a hand leaves at speed is dropped and the corners rounded, so what you get reads as deliberate rather than nervous
* A travel time tool on the canvas: click a point and the area you can reach from it — on foot, by bike, by car or on transit — becomes a mark you can name, recolour, move and keep, rather than something that vanishes when the tool closes. Drag its origin and the area comes with you, then redraws for where you actually put it
* A canvas can carry its own map appearance — 3D objects and terrain, HD roads, indoor maps, and the POI, road, transit and place labels. A hiking map wants terrain and no transit labels, a transit map wants the opposite, and neither should mean changing what you have set for everything else, so a canvas's own choices take over while you have it open and are handed back when you leave
* Canvases save themselves. There is no Save button — a canvas is a map you arrange while looking at it, not a document you finish and file, so every change is written a moment after you make it and the header says where that got to
* Undo and redo across a whole canvas, on ⌘Z and ⌘⇧Z or from the toolbar — layers, marks, names and colours alike, and the shape you are part-way through drawing. Stepping back past a finished shape puts it back under your cursor with its points intact, and stepping back again takes those points off one at a time; redo walks the same path forwards. A continuous gesture, like dragging a slider or drawing a stroke, is one step rather than several hundred
* Canvases can hold a saved route, and a People layer showing friends who are sharing their location with you, live. Nobody's position is ever written into the canvas; the layer only records whose to draw
* Share a canvas by link. Anyone with the link can open it and see its layers on the map without signing in, and revoking the link shuts that off immediately. Only shareable canvases can have one — a private canvas has nothing the server could show a visitor, and making a canvas private revokes its link on the spot
* A rebuilt layer editor. Building a layer now happens in the panel beside the map rather than in a dialog on top of it, and the layer is drawn as you work — a colour, a line width or a zoom cutoff is judged against the map you will actually see it on. It covers every kind of source: raster imagery, elevation, vector tiles, GeoJSON pasted straight in, and single images pinned to four corners. Style properties are laid out by what they draw — Stroke, Shape, Icon, Label — and anything you have not set shows its default rather than being written into your layer
* The map flies to a layer's data the first time it loads. Point a layer at a council's aerial imagery or paste a list of trailheads and you land on it, instead of hunting for it from wherever you happened to be. Pasted GeoJSON also picks its own renderer from what's in it — points draw as circles, lines as lines — so a layer never comes up blank because it was pointed at the wrong one
* Layers can be imported from a Mapbox Studio or Maputnik style. Paste the style, pick a layer from it, and it opens in the editor with its source attached. Anything that will not travel — a Mapbox-hosted source, sprite images or fonts from the original style — is called out before you import rather than after it renders nothing
* A layer store, reached from the Layers tab of your library. It holds every ready-made layer Parchment ships with, so anything you delete can be added back — there is no separate "restore defaults" any more. Terrain, Time Zones, Air Quality, Wildfires and OSM Notes now start out in the store rather than in your library, so a fresh library only carries what most people want on the map
* Canvas groups can hold other groups, so a large stack can be arranged in folders within folders
* Select a group on a canvas — or anything inside one — and everything you draw or add is filed there. The toolbar over the map names where that is
* A second toolbar under the drawing tools holds the settings for the tool in hand — a pin's glyph and shape, a shape's outline and fill, a travel time area's mode and reach
* Select a mark and its style goes onto the toolbar, so the next one you draw matches what you picked

### Changed

* The layer selector now separates map overlays, saved-place collections and canvases into a compact tabbed panel with a clearer base-map picker
* The desktop sidebar has been rebuilt. Rows sit on an even grid at full contrast, the current one is marked by a single raised chip that slides between them, and collapsing or expanding the rail now glides instead of snapping — with the map resizing in step
* The sidebar remembers whether it was collapsed, and the collapse toggle has moved to the top of the panel, next to the logo. Collapsed, the strip along the sidebar's edge lights up under the cursor and clicking it expands the panel again — `S` still works from anywhere
* The expanded sidebar can be dragged to whatever width you want, by its outer edge, and it remembers that too. Drag it well past its narrowest and it collapses to the icon rail; drag back out and it returns
* The account row at the bottom of the sidebar now lines up with the links above it, showing your name against a single line; your email is still in the menu it opens, which is wider and no longer clips a long address
* Parchment's own layers are no longer editable. Many of them are more than a block of map styling — transit stops you can tap for departures, friends moving around live, the day and night terminator — and opening them in the layer editor exposed settings that could not describe what they actually do. They can still be reordered, regrouped, toggled and deleted; the store puts back anything you remove
* Taking over one of Parchment's layers to make your own copy is gone, along with the copies-and-originals bookkeeping behind it. Layers you built yourself are untouched
* Deleting one of Parchment's layer groups now takes the layers inside it too, instead of scattering them across the top of your library. Adding the group back from the store brings the whole set with it. Your own layers filed inside such a group are moved out rather than deleted
* OSM notes are now a layer like any other: it sits in your library, reorders with everything else, and its place in the layer selector follows the order you set — rather than being pinned to the bottom of the list
* One picker, everywhere something can be recoloured — a pin, a collection, a layer's styling, a mark on a canvas. They all now open the same icon and colour picker over the same palette, so picking teal means the same teal wherever you pick it. Anything the palette doesn't cover can be typed in as a colour value, or taken straight off the screen with an eyedropper where the browser has one
* Pins on a canvas are drawn the way search results are, glyph and all — the icon you choose is the icon on the map, at the same size whatever the zoom. Saved places shrink and fade as you zoom out because the question there is "where have I saved things"; a pin you placed deliberately stays where and what you put it
* Canvas layers keep their colour on a night basemap. Mapbox dims the map after dark, which is right for buildings and wrong for something you drew, so marks and data layers now light themselves
* A canvas's layers and marks are one reorderable list now, bottom to top, so what covers what is whatever the list says. Related things can be gathered into a group with its own name and switch
* Canvases holding large imported datasets stay responsive as you edit them, and save without sending the whole document back and forth
* A pin on a canvas can be a circle, a square or just its icon. A square reads as a station or a stop the way the basemap already draws them, and a bare icon keeps a busy map quiet
* Canvases appear in the layer selector under their own group, so one can be switched on or off from the map without opening your library
* Trackers and friends are drawn like every other marker on the map — the same plate, ring and shadow a place wears, in the app's accent colour, at a size that keeps them above the map rather than in it. Each was previously its own hand-drawn circle, so a tracked car, a friend and the café beside them read as three unrelated marks
* A tracker or a friend whose position is too old to trust now goes grey and stops pulsing, instead of only fading a little
* A tracker's marker only pulses while its position is still current, rather than for a full day after the vehicle last reported
* The integrations page no longer offers an "Imagery" capability filter, which no integration provided. The rideshare filter is now named "Rideshare" instead of "Rideshare Estimate"

### Fixed

* A transfer opens the station it actually names. Tapping "Chambers St" from Brooklyn Bridge–City Hall opened the A/C/E station 428 metres away, because the only way to find it was to search by the name — and three stations are called Chambers St. Each one is now identified exactly, using the match the transit map itself already made

* Tapping any part of a station on the transit map opens the whole interchange, rather than one line's platforms. Tapping the J at Canal St opened the N/Q station instead — six separate stations share that name and nothing drawn on the map says which one a given marker belongs to, so "just this station" was picking an arbitrary one. The group's list contains every line the specific station runs, so nothing is lost by opening it
* Turning on the transit layer no longer erases the railway network from the map. The basemap's station labels step aside for the layer's own stops instead, so the rails stay drawn
* Lines you can walk to are listed separately from lines you can transfer to, instead of sharing one Transfers heading. At Rector St the 1 train is fifty metres away but reaching it means leaving through the turnstiles and paying a second fare, and listing it beside the genuine in-station transfers said otherwise. Walk-to lines now sit under their own heading with the distance beside them
* Tapping a station label that covers a whole interchange now shows all of its lines beside the station's name. The departures below already covered the whole interchange; the bullets did not, so Brooklyn Bridge–City Hall read "4 5 6" with the J and Z listed as connections — the answer for tapping one station rather than the group
* Tapping a station label that covers a whole interchange now opens all of it. New York draws four separate stations named "Canal St" as one symbol, and tapping it opened whichever of the four the label happened to sit on — so the panel showed two lines where the map had drawn six. Tapping a single line's marker still opens just that station
* The map keeps up with the sidebar as it is dragged or collapsed, resizing frame by frame rather than snapping once the panel has settled
* Centring on a place, or fitting a route, no longer aims too far to the right when a panel is open over the map. The gutter the map was told to leave on the left included the sidebar's width a second time, even though the map never extended under it — worse the wider the sidebar
* The globe sits in the middle of the map when a panel is open. That same gutter moves the point the map is centred on off the middle of the screen, which a flat map hides and a globe cannot, so it is dropped while the globe is on screen
* Buttons and other controls show the hand cursor again — they had been left on the arrow, so nothing in the app looked clickable
* The tick beside a custom colour now applies it and closes the picker, rather than leaving the picker open with nothing apparently happening
* Escape works again in views that bind it alongside another. Several parts of the app listen for Escape at once, and closing any one of them quietly took the others' handling with it — so Escape could stop dismissing a panel until the page was reloaded
* Undo and redo on a canvas now work while the cursor is in a text field. Naming a mark and then pressing ⌘Z used to do nothing, though the toolbar button worked
* Reordering a canvas's layers and marks now changes what covers what on the map straight away, instead of only after something else made it redraw
* Restyling a canvas layer no longer quietly lifts it above the layers it was sitting under
* Marks around the one you are reshaping or hiding no longer flicker off the map and back
* A travel time area is no longer lost when you change its mode or reach while it is still being worked out

## [0.8.3] - 2026-09-02

### Changed

* Lines you can transfer to without leaving a station have their own Transfers section below the departures, instead of being mixed into the station's own bullets
* The toolbox button has been removed from the map. Measure, radius and isochrone are still available from the map's right-click menu, and the setting for showing the toolbox is gone from Settings
* The capability filters in integration settings are listed alphabetically

### Fixed

* A station's line bullets no longer claim a transfer line isn't running. The row beside a station's name listed every line in its transfer complex and dimmed the ones with nothing on the board — but a transfer line never has anything on that board, so the 4, 5, 6 and 6X at Chambers St all read "isn't running now" while the trains were arriving one platform away. The row now shows only the lines that stop here
* OSM tag groups with subfields are easier to read in place details, and each individual value can now be copied on its own instead of only as one combined block
* Trees and street furniture on the map were being drawn inside-out, so they were lit by the side of themselves facing away from you and came out flat and too dark. They now catch the light on the surface you can actually see
* The Brand Catalog, Transit Routing and Rideshare Estimate capability filters in integration settings show their names instead of raw translation keys, in English and Spanish
* A subway station's departure board shows that station's own lines. Opening Brooklyn Bridge–City Hall listed trains from the Chambers St platforms 14 m nearer and buried its own 4, 5 and 6 at the bottom, each departure printed twice
* Line bullets in a station header show the right line. New York's subway 4, 5, 6 and 7 share their route ids with Long Island Rail Road branches, and every one of them was drawn as a Ronkonkoma, Montauk, Long Beach or Far Rockaway pill
* A station's line-up now lists the lines it runs before the ones an in-station transfer reaches, instead of mixing them together

## [0.8.2] - 2026-09-01

### Changed

* The daylight map has colour in it. The ground is a warm cream rather than a cool near-white, parks and woods a soft spring green, water a light sky blue, beaches sand, hospitals rose, and buildings a light grey that sits on the land instead of blending into it — so a neighbourhood has a shape before you read a single label
* School and university grounds are amber instead of pale blue, which on a map with water on it was a colour that already meant something else
* Buildings carry more of their own recorded paint colour again in daylight, back to the strength it was tuned at before it was cut — the roof they tint is no longer near-white, so there is room for the hue without a street of brick reading as a wash over the land. A building's paint now darkens it as well as tinting it, which is what makes a brown building read as brown rather than tan: brown is dark orange, and a tint that carried only the hue drew a street of brick as gold. It only ever darkens, so a pale facade no longer lights its building up out of the city around it at night. At night the tint is quieter than it has ever been: against dark ground a strong one reads as lit surfaces rather than painted ones, so a brick block is now a shade off a rendered one rather than its own colour
* Sports pitches, playgrounds and stadium grounds carry a thin darker edge in their own colour, so a field reads as a bounded surface rather than a soft patch of green
* Ballfields and sand — a baseball infield, a bunker, a playground pit — are drawn on top of the grass around them rather than underneath it, so they read as their own surface instead of a faded patch of the park

## [0.8.1] - 2026-08-31

### Changed

* Settings open with ⌘, (Ctrl+, on Windows and Linux), the shortcut every other app uses, instead of a bare comma. Keyboard hints throughout the app now name the right key for the machine you're on rather than always showing ⌘
* Buildings take a lighter tint from the colour recorded for them. The tint is there to tell one building from its neighbour, and at the old strength a street of brick or painted render read as a wash of colour over the land rather than as buildings standing on it
* Trees and buildings no longer break into flickering patches when the map is flat on. The plan view fakes an overhead camera by pushing the camera far enough back that the walls disappear, and at that distance the depth the map draws with was too coarse to tell the front of a tree from its back, or a roof from the wall under it
* Place icons on the map are drawn crisply. They were built at twice the size they render at and handed to the map engine that way, which then point-sampled them back down and threw half the edge away — so a disc came out with a stair-stepped rim next to a search-result pin the browser had drawn cleanly. The soft glow under a marker no longer ends in a faint square either
* At night, the ring around a place icon is a shade darker than the icon itself rather than the near-white the glyph wears. A pale ring on a dark map was the loudest part of the marker; a darker one reads as a seam and lets the glyph carry the mark
* Search-result pins are drawn the same way as the places already on the map — the same tinted plate, glyph and ring — instead of a flat disc in the raw category colour. A café you searched for and the café under it are now visibly the same thing
* Search-result labels follow the theme. On the MapLibre engine they were stuck in daylight colours whatever the map was doing, so a night map carried orange names with a white outline over dark ground. The same fix reaches the outline around saved places, which was white at night for the same reason
* Buildings with modelled parts are drawn once instead of twice, on a server that can tell them apart. OpenStreetMap maps a detailed building as an outline plus separate pieces inside it holding the real heights, and the map was drawing both — one building at its true height and a second at a default one, in a default colour, the two flickering against each other wherever they met. The pieces are what you see now, and the outline they belong to is left out
* Roofs take their own colour where OpenStreetMap records one, rather than wearing the walls'. A building that records only a wall colour is unchanged, roof and all
* Buildings wear their own paint colour across the whole spectrum. A building's tint was scaled by how far its colour sat from its own luminance, which a dark colour has little of however saturated it is — so maroon, bottle green and dark brown facades barely tinted at all, while pale ones tinted strongly. It was measured against luminance too, where blue counts for a fifteenth of what green does, so the palette collapsed onto a blue-and-yellow axis: on the night map a dark red building came out blue, and so did a brown one and a pink one. Hue now survives intact at any lightness, still as a hint of the colour rather than the colour itself — and a grey facade of any shade, including the ones tagged plain `black` or `white`, still renders as an ordinary building
* Streets below the main road network are drawn wider. The map gave up colour for road hierarchy and left the weight to carry it, but the weights were cut for a map that still had colour — so a residential grid came out as a mesh of threads. Their outlines no longer vanish at middling zooms either, which is where they used to converge on the road itself
* Fewer place icons fall back to a map pin. Roughly half the icons in the OpenStreetMap preset schema name an icon set Parchment does not ship, and every one of them silently became a pin — which is why a Mexican restaurant showed a pin while the same restaurant on the map showed a plate of food. A place now inherits from what it is a kind of, so a taqueria gets the restaurant glyph and a police station gets the police one

### Fixed
* Beaches and deserts are sand-coloured on the dark map instead of turquoise. The night palette inherited a saturated cyan for sand, which made a shoreline read as a band of tropical water laid between the town and the sea

* The map draws its tiles again. Parchment asked Barrelman for them at an address it stopped serving from — before it made tiles metered and revocable, tiles sat at the top level; now they sit under `/tiles`. It also looked the host up under a name the integration has never stored, so every request went to a local default whatever the integration was pointed at, and the basemap, parking, trees and street detail all came back empty
* Buildings sit in the ground again instead of on top of it. Tilting the camera with 3D terrain on showed ten metres of wall below the pavement: buildings are given a basement so one on a slope does not hang in the air on its low side, and the ground is what hides it — but they were also being pushed in front of the ground so they would always win, a fix for a flickering that only ever happened looking straight down. The push grew with the tilt, so the further you leaned the deeper they came up out of the earth, each one that much taller and the trees beside them left hanging over a ground line that had dropped away. Buildings on a flat map were carrying the same basement with nothing at all to bury it
* The map engine's own locate button no longer appears next to Parchment's
* The map draws again on the MapLibre engine. A released build was missing one file the map's background worker loads, so the worker died the moment it started — silently, with nothing in the console and not a single tile ever requested. The map sat blank behind everything else, which carried on working: search found places, panels opened, the transit layer was there, all of it over empty space

## [0.8.0] - 2026-08-27

### Added

* Trees on the map as actual trees rather than green dots, behind a new "3D objects" switch under Appearance — separate from "3D buildings", which used to carry both
* Eleven tree models across broadleaf, conifer and palm, chosen from the tree's genus, species or leaf type. Each one is sized, turned and shaded from its own id, so a street is a row of different trees rather than one tree repeated — and the same tree looks the same every time you come back. Height, crown width and trunk girth come from OpenStreetMap wherever a surveyor recorded them
* Tree-lined streets get their trees. An avenue is usually one line in OpenStreetMap rather than a tree per node, so those lines are now planted along at a realistic spacing
* Bins, recycling containers and benches, at the closest zooms. Benches face the way they actually face, using the direction recorded for them — the ones with no direction recorded are left out, since a bench pointed the wrong way reads worse than no bench
* Parking lots are drawn on the map, as paved surfaces with a fine edge. Multi-storey and underground parking are left to the buildings layer, since neither is ground you can see from above

### Changed

* The map has a new basemap, in daylight and at night. Streets, land, water and labels are drawn the way a professional cartographer set them rather than by darkening the light map with maths — which is what the old night map did, and why it collapsed into one flat field of purple where a motorway and a driveway differed only in shade. Roads now carry a real hierarchy at every zoom, parks and water read as themselves, and labels sit at the weights they should
* The daylight map has cooled from parchment cream to a near-neutral grey, matching the app's own chrome — and its motorways and main roads have given up the orange and yellow that digital maps inherited from paper road atlases. The hierarchy is still there, drawn in weight and in shade rather than in colour: main roads stay white, motorways run a step darker than the ground, and each rung carries a heavier edge than the one below it
* 3D terrain works on both map engines and no longer needs a Mapbox account. Both now read the same free public elevation data, so hills are the same shape whichever engine you are on — the MapLibre engine had no terrain at all before this
* Places on the map wear proper icons, coloured by what they are — and by the same palette the app already uses for search results, so a café you find by searching and the same café drawn on the map finally match
* Place markers on the map are drawn the way a place's icon is drawn in its detail panel: a pale tinted disc with the glyph in the deeper shade of the same colour, and an outline to match. The white ring is back, a little wider than before, and it now carries the marker's own colour rather than the map's background — and the soft shadow under it stays, which it could not before, since a map marker only gets one halo and it was spending it on one or the other
* The map tilts further — to 85 degrees, up from 60 — with a sky and a haze at the horizon so a steep view ends in something map-like rather than in nothing
* Trees stand on a trunk rather than a plinth. The models are drawn to read at arm's length in a game, where a chunky trunk is part of the look — one was very nearly as wide as its own crown, which from above is a brown post with a bush balanced on it. The heaviest are now cut by half or more, and the ones that were already reasonable are left alone
* A tree is lit from above. The shading followed the sun alone, so a low sun put the dark side of every crown at the top of the screen and a park full of trees read as inside-out from a plan view. Crowns are now brightest at the top and fall away underneath, whatever the sun is doing, with the sun still deciding which flank is the brighter
* Trees are a friendlier green in daylight, on a lighter trunk, and they no longer stand in front of place markers and labels — anything you can read now sits above anything you can only look at
* Tunnels are drawn see-through, so a road that dives under something reads as going under it rather than as another junction on the surface. Railway, footway and culverted-river tunnels were already fainter than this and are left alone
* Buildings hide the one-way arrows on any road they stand over, instead of letting them float across the roof
* Footpaths and pedestrian squares are drawn with a heavier edge, so a pavement holds its shape against the ground beside it
* 3D buildings no longer break into a flickering mosaic of slivers looking straight down with 3D terrain on. Terrain put a real surface directly under every building, and the near-parallel camera the plan view uses left too little depth precision to tell the two apart
* 3D buildings stand on the terrain instead of at sea level. With 3D terrain switched on, any ground above sea level swallowed them: over a hill the whole skyline disappeared and only its shadows were left on the slope
* Map labels are set in Geist — the same typeface as the rest of the app — served from Parchment itself rather than fetched from someone else's font server on every pan. Transit stop names are set a weight heavier, so a stop stands out from the street names around it
* Looking straight down, the map is drawn without perspective. A flat-on view used to keep a vanishing point — building walls splayed outward from the middle of the screen and roofs sat offset from their own footprints — so a plan view never quite read as a plan. Tilting at all brings the perspective camera straight back
* Buildings rise out of the ground as you zoom past the level they appear at, rather than springing up at full height the moment they switch on
* 3D buildings appear a zoom level earlier, so a skyline reads as a skyline from further out instead of only once most of it is off screen
* Parks inside a university or hospital campus are drawn as parks. Washington Square Park sits inside NYU's grounds and was coming out as a flat blue slab, along with several blocks around it — land use no longer paints over what is physically on the ground
* Building shadows follow the real sun. The map works out where the sun actually is over whatever you are looking at, and throws the shadows accordingly — east and long in the afternoon, short at midday, the other way round in the southern hemisphere — fading them out overnight while the shading that separates one building from the next stays. Shadows also ease in as you zoom to them rather than appearing all at once, and lighten looking straight down, where a full-strength shadow reads as a stain on the ground rather than as depth
* Buildings have softly rounded corners rather than knife-edged ones
* Buildings keep their outlines looking straight down, not just when the map is tilted
* One-way arrows are drawn to fit inside the road rather than overhanging it
* Transit stops on the map wear a small blue square rather than a large coloured circle, so a station reads as a station rather than as another place to visit — and the basemap's own stops step aside while the transit layer is on, instead of doubling up with it
* Sidewalks and footpaths are drawn as paved surfaces — a pale band with a fine grey edge — rather than as dotted grey trails, and pedestrian squares now join them seamlessly instead of showing a seam where a path crosses a plaza
* Pavements now sit under the streets and under the buildings, where they belong — they were drawing over both, so a path cut across every junction and ran straight through buildings in a tilted view. Footbridges are the exception and still cross over the road
* Place names on the map are set a little heavier, and each place marker casts a soft shadow so it lifts off the map
* Highways wear their real route markers. An interstate gets the blue-and-red shield, a US route the white escutcheon, and everything else a plaque sized to the route number — replacing the plain white box every road used to get regardless of what kind of road it was. Interstate shields were missing from the map altogether and are back. The markers keep their real colours at night, as road signs do
* Every map icon is drawn at its intended size on a high-resolution display. The sprite sheet for those screens was being built at twice the scale it should have been, so icons and route markers came out around 70% too large there while looking correct on an ordinary monitor
* Buildings are painted their real colours where OpenStreetMap knows them, which in a well-mapped city is most of them — so a red brick block, a glass tower and a limestone facade no longer come out as the same beige. Only the hue is taken, not the brightness: a building someone tagged plain "black" or "white" would otherwise land as a hole punched in the map, and how light a building sits is the map's decision, not the paint's
* The sun falls on the 3D buildings. They cast shadows across the streets, darken into the ground where a wall meets it, shade by which way each wall faces, and carry a fine line along the roofline where the wall meets the roof — so a block reads as a row of separate buildings with depth between them instead of one grey mass. At night the shadows all but disappear, since there is no sun up, but the shading and the edges that separate one building from the next stay
* Buildings are solid rather than translucent, so a tower reads as a building instead of letting the streets and land underneath show through it — and a transit route crossing in front of one now blends with the building rather than with the ground beneath it
* Two ways to draw places on the map, switchable under Appearance. The default gives each place a coloured badge matching its category — the same marker a search result wears. The alternative drops the badge and draws the icon alone in MapTiler Streets' own palette, for a quieter map that leans on the cartography rather than on markers. Both are drawn for day and night separately

## [0.7.0] - 2026-08-22

### Added

* Photos on a place open full size. Tapping one in the strip grows it out of the thumbnail into a full screen viewer you can pinch to zoom into, drag around and swipe between, and flick away to close. Until now the strip was all there was — you could scroll past a photo but never actually look at it
* The Transit layer draws a real transit map now. Routes used to pile onto the same street as a tangle of overlapping lines; they now run as parallel coloured ribbons that share a corridor the way a printed network map draws them, with station markers, route bullets under the station names, and line names set along the track. The layer selector folds it into four switches — Rail, Bus, Ferry and Other — so the bus network can rest while you read the rails
* A service-time control under the Transit layer. The map opens on what is running right now and follows the clock; drag the slider or pick a weekday to see another moment — the Sunday-night network, tomorrow's rush hour — and lines that are asleep at that hour leave the map, along with their bullets on the station labels. "Live" returns to now
* Stations on the transit map open their stop page with a tap — departures, lines and alerts, the same page a stop found through search shows. It is also the same page the station opens as an ordinary map pin, rather than a second page about the same platform
* Route bullets on a station's header say whether the line is running. One with nothing coming is dimmed and says so, and tapping any of them opens that line

### Changed

* Opening a line from a stop's departure board shows that line alone — and shows it as it runs at this hour. Lines are shortened, rerouted or suspended through the day, and the stretch a line isn't covering right now leaves the map along with its stops, instead of drawing the longest version of the route at three in the morning
* Route bullets everywhere in the app are drawn the way the map draws them. They read in the order the operator uses — Columbus Circle lists A·C, B·D, 1·2 by trunk colour rather than alphabetically — they wear the shape the local system gives them, so a Mexico City line sits in its rounded square instead of a circle, and a pale bullet takes dark lettering instead of white on yellow

## [0.6.0] - 2026-08-18

### Added

* A WiFi shortcut in the search palette. It isn't a kind of place — it browses everywhere carrying free wireless, so cafes, libraries and hotels all turn up
* Service alerts from the transit agency, wherever they affect you: on a line, on a stop's departure board, and on the legs of a planned trip. A detour, a suspension or a lift out of service now shows up in the app instead of sending you to the agency's website. They read as a row of small cards you swipe through rather than a wall of text — what is actually happening now comes first, scheduled overnight work is counted off to the side, and tapping one opens the agency's full wording
* Twenty-five more browse shortcuts: train stations, airports, places of worship, schools, childcare, ice cream, dentists, urgent care, beauty salons, laundry, car wash, car rental, pet stores, farmers markets, dog parks, public art, viewpoints, nature reserves, beaches, picnic areas, fountains, showers, public bookcases, outdoor gyms and bike repair stations

### Changed

* Right-clicking the map shows the place's own icon, in its category colour, instead of a generic pin — a cafe reads as a cafe before you open it
* The search palette opens instantly. It used to wait on your recent searches — which are encrypted, so they have to be fetched and unlocked first — before drawing anything at all, leaving the first open of a session on a spinner. Your shortcuts and frequent places now appear immediately and recents drop in as they arrive
* "Bus Stops" is now "Transit", and covers tram and rail platforms alongside buses
* Searching "wifi" finds the category under that name rather than "Wi-Fi Hotspot", and bike repair stands are called that instead of "Bicycle Repair Tool Stand" — both in search and on the place itself. Searching "bike repair stand", "repair stand", "outdoor gym" or "calisthenics" now finds the right category too
* Recents on the Library home no longer stop at five — the list starts with ten and keeps loading more as you scroll
* Departure boards now cover the next three hours, with a "Show later departures" button for the rest of the day. The board used to be sized by a fixed number of runs rather than by time, which meant it showed barely the next 45 minutes at a busy subway platform and five hours at a ferry landing — and at a stop that had shut for the night, nothing at all
* A transit leg is now drawn on the trip's own timeline rather than in a card beside it. The line runs straight through the card — the stop you board at, every stop along the way and the stop you get off at are dots on the same line as the rest of the journey, instead of a second timeline nested inside the first
* Departures on another day now say which day. A run more than a couple of hours out shows its clock time instead of an ever-growing "10h 21m", and the first run of each new day is marked. A tram at 1:45 AM that still belongs to tonight's timetable reads "Tonight" rather than "Tomorrow" — the timetable's own service day decides, not the calendar. A stop closed for the night now says so above its next day's departures

### Fixed

* 3D trees no longer shatter into a flickering patchwork looking straight down, or show cracks of ground through their crowns. The plan view pushes the camera far enough back to fake a flat-on projection, and at that distance the depth buffer could not tell the front of a crown from its back — so the two fought over every pixel, and since the back of a leaf is lit from the opposite side the tree broke into light and dark wedges that crawled as the camera moved. This is the same loss of depth precision that used to shatter the buildings, arriving by a different route. Fixing it meant fixing the models too: the distant stand-ins were built inside out, and several of the trees had leaves facing the wrong way round
* Panning a map full of 3D trees no longer stutters. The scene was being rebuilt inside the frame that was trying to draw it, and rebuilt again for every tile of every source that arrived — including sources with no trees in them — so a pan across a leafy city dropped a frame each time. The rebuild now happens between frames, once per burst of arriving tiles, and only the part that actually changed: panning re-sorts what is already there rather than reading it all back out of the map
* Place markers on the map are round again. They are assembled from the sprite sheet's own artwork now that they carry four colours instead of one, and were being built at the sheet's resolution rather than the screen's — so at the size a marker actually draws, the disc came out with visibly stepped edges and read as a rounded square
* The night map is less blue. Minor streets were being painted a saturated cyan that read as water at a glance, and the halo behind every label on the map was the same colour — both were picking up a colour meant for glaciers, along with runways, cable cars and tunnels. Each is back to the shade it was drawn with, and residential streets now sit in the same family as the main roads they join
* Recents on the Library home now include your searches, not just the places you opened. A category or brand you browsed showed up in the search palette's recents but was missing from the home list — the two now show the same history, newest first, and tapping a search there runs it again
* The "Inside" and "Located in" rows on a place no longer run their first two cards together — every card in the row is evenly spaced
* Opening hours are read properly. Parchment now understands the full OpenStreetMap hours notation instead of a rough approximation of it, and several common ways of writing hours were being read wrongly or thrown away entirely: a place open "08:00-12:00, 13:00-18:00" lost its whole afternoon, hours written as "9:00" rather than "09:00" reported the place shut all morning, and weekend ranges like "Sa-Su" were discarded, leaving no hours at all. Bars and diners that stay open past midnight now stay open on screen until they actually close, rather than flipping to "Closed" at midnight. Places that only open part of the year, keep different hours on public holidays, or open from sunrise to sunset are now read as written
* Hours for a place in another time zone are worked out on that place's clock, and the page now says which clock it is showing — so a shop in Tokyo reads "Open now" while it is the middle of the night where you are, with its local time alongside
* A place whose opening hours are a note rather than a schedule no longer announces itself as open around the clock. "Temporarily closed", "by appointment" and the like have no hours to read, and were being taken as an unbroken week — so a business that had shut its doors advertised itself as open 24 hours. What the mapper actually wrote is now shown in place of an open-or-closed status
* The "Open now" filter judges each place on its own clock. Search results carried no time zone of their own, so filtering a city several hours ahead of you was done against your clock, and could hide places that were open
* Places that have permanently closed now say so instead of showing "Open now". A shut-down business is usually marked in OpenStreetMap by retiring its category — a closed cafe becomes a "disused cafe" — and Parchment only recognised a rarer, separate marking, so most closed places kept advertising the hours they kept when they were trading. The old weekly schedule is no longer shown, closure holds even when the hours came from another listing service, and closed places now sort below everything still open in search
* Aerial tramway, cable car and gondola stations are recognised as transit stations. The Roosevelt Island Tramway rendered as an ordinary building, with no departures and no lines served
* A station's departure board is now that station's departures. Opening the Roosevelt Island Tramway listed mostly Q32, M15 and Q60 buses bound for Penn Station, from stops across the street — a stop standing on the place now claims the board, and its platforms travel with it
* Trams and streetcars are no longer labelled buses. Every tram route in every feed was being read as a bus on the way in, so they carried a bus name and a bus icon throughout the app
* A route with no short name shows its mode rather than an internal number. The Roosevelt Island Tramway wore a green "10092" badge, which is its id in the timetable and means nothing to a rider
* Stations are now matched to the right stop rather than the closest one. A ferry terminal would pick up the bus stop across the street and show its departures under the ferry's name; the same happened at rail stations sitting metres from a bus shelter. The station's own mode is now preferred, and reached for further out — a ferry landing's stop sits at the end of the pier
* A departure weeks away no longer turns up on a board beside trains due in minutes. Where a station's board merges several nearby stops, one seldom-used neighbour could contribute a run from the far side of the timetable
* The departure board has been redesigned around one idea: what the agency tells us and what we merely estimate should never look the same. A run that has departed or been cancelled fades back, because it genuinely isn't an option. A run we only think you might not reach keeps its full weight and just changes colour, because you are often closer to the platform than we can tell. Every departure now sits on the same footprint, so the row reads as one rhythm instead of a ragged line
* Departures that are running late or early now say so. The agency has been publishing the delay all along and we were quietly throwing it away — a live departure now shows its timetabled time struck through beside the real one, so "2:21 2:24" reads at a glance, with the new time tinted when a vehicle is off schedule
* Cancelled departures stay on the board, struck through and clearly labelled, instead of silently disappearing. A train vanishing with no explanation was worse than seeing it was pulled. Parchment won't reroute your later connections onto a cancelled run, but you can still tap one if you know better
* The realtime indicator no longer disappears from a departure you have to hurry for — whether a time is a live prediction and whether you can make it are two different things, and the board now shows both
* "Arrive early" now goes down to zero for riders happy to step straight onto the train, and it finally applies to the departure board: the margin you set is what decides which departures get flagged as a tight connection. It used to be a fixed three minutes there regardless of your preference
* The departure board no longer greys out trains you can plainly catch. It used to hold on to the walking time from when you planned the trip, so a seven-minute walk still read as seven minutes even once you were standing on the platform. The walk now counts down as you approach the stop — from your actual position when location is on, otherwise from the clock — and any departure on the board can be picked, whether it's already gone or looks like a stretch. Those still read as departed or as a "hurry" or "may miss", but they're a hint now, not a lock

## [0.5.11] - 2026-08-03

### Added

* Indoor maps — switch it on under Appearance and airports, malls and stadiums that Mapbox has mapped inside show their floor plans, with a floor selector on the edge of the map for moving between levels

### Changed

* Looking up an address — right-clicking the map, dropping a pin, searching a street — now answers from your own Barrelman instance instead of the public OpenStreetMap geocoder. It's faster, isn't rate limited, and the place you land on comes back with its real outline, opening hours and tags rather than just a name. Nominatim and the other providers stay on as fallbacks for anywhere outside the regions you've imported
* Right-clicking somewhere with nothing on it — a park, a field, open water — now names the town or city you're in instead of coming back blank
* Places now look the same everywhere they appear — search results, saved places, your frequent places, recents and trip stops all share one card, so an icon, a name and an address read the same way wherever you meet them
* Category icons are now tinted in their own colour rather than sitting as a flat white glyph on a solid block, matching how your saved places have always looked
* The search palette's browse shortcuts go from 12 categories to 44, including the small things other map apps skip — restrooms, drinking water, benches, picnic tables, bike parking, trash cans, bus stops and defibrillators. Each chip is now sized to its own label, and categories matching what you type appear as the same chips instead of taking up a list row each
* Places now read in your language, not just the app around them. A place shows the name it's known by in your language where mappers have recorded one — the Hudson River is "Río Hudson" in Spanish — along with its type ("Parque" rather than "Park") and its detail tags ("Perros con correa", "Prohibido fumar"). You can search by that name too, so looking for "Consulado General de Irlanda" finds it

### Fixed

* Search, place detail and geocoding no longer go dark when Barrelman's transit data is stale. A single degraded subsystem was enough to make Parchment drop the connection entirely, taking every other Barrelman feature down with it
* Error messages from the server now come back in your language rather than always in English — sharing, saved places, routes, layers, vehicles, notes, account settings and the OpenStreetMap connection were all still answering in English regardless of what you'd set
* Sign-in codes now actually expire. The email has always said the code is good for 15 minutes, but the server accepted it indefinitely — an old code sitting in a mailbox stayed usable until you requested a new one. Codes past 15 minutes are now refused, and entering one tells you it's expired rather than that it's wrong
* Sign-in codes and invitation emails are now written in your language. Sign-in codes follow the language saved on your account; an invitation follows the language of whoever sent it, since the person receiving it doesn't have an account yet
* Place descriptions from Wikipedia come back again. Parchment was asking for `en-US.wikipedia.org`, which doesn't exist, so the summary on a place's detail view had been silently blank in every language

## [0.5.10] - 2026-07-30

### Added

* Your saved places now appear on the map, wearing the icon and colour of the collection they're in. Zoomed out they show as dots; zoom in and the collection's icon fills in. Home, Work and School keep their own markers
* The layer picker now expands, so you can toggle what's inside a group — including a new "Saved places" group with a switch per collection
* New isochrone tool — drop a point and see how far you can get in a given time on foot, by bike, by car or on transit, drawn as shaded travel-time bands. It works in reverse too, showing everywhere that can reach the point

### Changed

* Saved places take their icon and colour from the place itself in your lists, and from their collection on the map. The per-bookmark icon picker is gone

### Fixed

* The final step of a set of directions shows the arrival flag again instead of a turn arrow
* Toggle buttons now highlight the option you picked
* The desktop and mobile apps are up to date again — 0.5.9 reached the web and server but its app builds failed, so everything above arrives on iOS, Android and desktop with this release

## [0.5.9] - 2026-07-30

### Added

* Your saved places now appear on the map, wearing the icon and colour of the collection they're in. Zoomed out they show as dots; zoom in and the collection's icon fills in. Home, Work and School keep their own markers
* The layer picker now expands, so you can toggle what's inside a group — including a new "Saved places" group with a switch per collection
* New isochrone tool — drop a point and see how far you can get in a given time on foot, by bike, by car or on transit, drawn as shaded travel-time bands. It works in reverse too, showing everywhere that can reach the point

### Changed

* Saved places take their icon and colour from the place itself in your lists, and from their collection on the map. The per-bookmark icon picker is gone

### Fixed

* The final step of a set of directions shows the arrival flag again instead of a turn arrow
* Toggle buttons now highlight the option you picked

## [0.5.8] - 2026-07-29

### Changed

* Place search is dramatically faster — results now appear as you type instead of lagging a beat behind, and suggestions no longer flicker or briefly show matches for an earlier keystroke

### Fixed

* Neighbouring businesses that share a name — two locations of the same chain on one street, adjacent mall units — no longer collapse into a single map pin when their street addresses clearly differ

## [0.5.7] - 2026-07-27

### Changed

* Inviting users now respects your own roles — you can assign any role you already hold when inviting someone (so alpha testers can invite other alpha testers), and the invite form only offers the roles you're allowed to grant

## [0.5.6] - 2026-07-23

### Added

* Alpha testers can now invite new users

### Fixed

* Time zones map layer now loads correctly in production again

## [0.5.5] - 2026-07-23

### Fixed

* Time zones map layer now loads correctly in production again

## [0.5.3] - 2026-07-20

### Added

* Compass heading beam — the location marker now shows a live direction beam that widens when the compass reading is less certain

### Changed

* Refreshed heading typography — headings now use the Exposure display typeface, with weight tuned per heading level
* Further error-reporting reliability and hosted-deployment tile fixes

### Fixed

* Saved map layers now load immediately after a fresh sign-in, instead of only after a reload

## [0.5.2] - 2026-07-19

### Changed

* More reliable error reporting — server-side errors and crashes now consistently reach the observability pipeline, including a live-reconfigure path when logging settings change
* Hosted-deployment fixes for basemap map tiles

## [0.5.1] - 2026-07-18

### Changed

* Subscription billing groundwork — license verification and Polar billing configuration wired up for the hosted service (no change for self-hosted instances)
* Clearer self-hosting setup — the example environment file now points self-hosters to full-access mode and marks billing variables as hosted-only
* Assorted fixes and internal improvements

## [0.5.0] - 2026-07-17

### Added

* Air quality & wildfire map layers — new Air Quality and Wildfire layer groups powered by OpenAQ and NASA FIRMS, with live readouts that follow each region's own AQI standard and aggregate nearby monitoring stations
* Look Around street imagery — peek at street-level imagery right from a place's detail view, opening full-screen with smoother navigation and mobile polish
* Brand search — find every location of a chain with real brand logos and browse them on the map
* Reorganized search — dedicated Recents and Categories sections, results that page as you scroll and reframe the map as they widen, ranked nearest-first
* Transit departure board — a transit-style board with live countdown cards, and interchangeable routes merged into a single trip (e.g. "4 or 5")
* Smarter trip planning — better handling of shared vehicles, parking, and walking time in multimodal directions
* Redesigned place detail — routable tabs, with home, work, and school presets across the dashboard, collections, and directions
* Richer place info from Foursquare — reviews, cuisine, and more
* Map rotation snapping — snap the map to north or to a city's street grid as you rotate

### Changed

* Reorganized settings into clearer Behavior and Appearance sections, with full-screen dialogs on mobile and a consistent close button
* More resilient third-party integrations with automatic background retries
* Quieter, cleaner server logging, plus assorted performance and reliability improvements

## [0.4.0] - 2026-06-24

### Added

* Transit trip planner — full multimodal directions that combine walking, transit, cycling, driving, rideshare, and shared bikes/scooters into one ranked list of trips, powered by a MOTIS unified routing graph
* Live transit — real-time vehicle positions on the map (NYC MTA bus & subway, LIRR, Metro-North, and NYC Ferry) with schedule-aware interpolation, an Apple Maps–style route detail panel, and a stop departures widget
* Transit trip detail — a unified timeline with line-colored cards, board/alight stops, intermediate stops, service alerts, and a departure picker that instantly re-plans the trip around a later run
* Shared mobility — direct bikeshare/scooter trips and transit access/egress via GBFS (Citi Bike), with live dock availability, rental fare estimates, and unlock deep links
* Rideshare — Uber and Lyft as a directions mode and as transit access/egress, with price ranges and pickup ETAs
* Smarter trip ranking — balanced sort weighs fares as time, surfaces least-transfer and simpler one-seat rides, and is wheelchair-aware (entrance snapping, fare-gate delays, park-and-ride)
* Shareable, recoverable trips — directions encode in the URL and trips persist server-side, so a shared or refreshed link restores the exact plan
* Redesigned mobile directions sheet — opens at a content-fitted peek showing just the inputs and expands to full once results load

## [0.3.0] - 2026-05-31

### Added

* Multimodal trip planner — plan trips with transit, walking, cycling, driving, and park-and-ride combinations powered by MOTIS and GraphHopper
* Multi-itinerary transit — returns multiple trip candidates from MOTIS, scored across fastest, fewest transfers, and least walking
* Departure time picker and sort preferences for trip planning
* Transit detail view — route-colored timeline segments, departure cards, and stop lists
* Realtime transit indicators — wifi icon and delay labels on departure boards and trip segments, powered by GTFS-RT
* Park-and-ride support — finds parking near transit stops and composes drive→park→transit→walk trips
* Per-waypoint time constraints — departAfter, arriveBy, and dwellTime on any stop
* Onboarding wizard — profile setup, alias, recovery key, passkey, theme, and subscription steps for new users
* Admin user management — user detail pages, role CRUD, permission management, impersonation, and pagination
* Avatar upload and serving
* Dashboard with inline command palette, pinned bookmarks, and card layout

### Changed

* Full UI redesign — warm neominimal theme, 3D depth styling on buttons/inputs/cards, Geist and Boston Angel typography
* Redesigned friends page, place detail, trip timeline, settings sidebar, and library layout
* Redesigned trip detail timeline with colored segments and aligned mode icons
* Migrated transit departures from Transitland to Barrelman (MOTIS stoptimes)
* Removed dead Transitland code from place service

### Fixed

* Widget transit detection crashing on Place amenities shape
* Dialog open animation flying in from top-left corner
* Orphaned and duplicated markers on style reload and drag
* Cycling/walking speed using wrong GraphHopper modifier
* Command palette vertical positioning after dialog centering change
* Location sharing, auth middleware, and polygon layer bugs
* Marker layer watcher leaks causing stale map markers

## [0.2.0] - 2026-05-21

### Added

* Basic subscription tier — a new $1/month plan that unlocks all user content features like bookmarks, collections, friends, location sharing, map notes, custom layers, and integrations
* Per-feature permission guards — server endpoints now enforce granular permissions so free users get a read-only experience while subscribers unlock content creation
* Upgrade prompts — free users see a clear upgrade banner when they visit Library, Friends, or Timeline
* 3-tier billing page — settings now shows a side-by-side comparison of Free, Basic, and Premium plans with live pricing from Polar
* Search within visible map area — search results now respect the unobstructed map viewport instead of the full screen bounds

## [0.1.6] - 2026-04-29

### Added

* Live friend locations — friends on the map now move in real time instead of waiting for the next refresh, with stronger privacy and security under the hood
* Smoother map movement — friend markers glide between updates instead of jumping, so the map feels more natural to watch
* Easier on your battery — map animations now pause when nothing is moving and use less power overall
* Timeline page — a new dedicated page (with map view and nav shortcut on mobile and desktop) for browsing where you’ve been
* Recent visits on places — place pages now show a timeline of your past visits, powered by your connected Dawarich account
* Dawarich location history support — connect Dawarich to bring your full location history into Parchment

## [0.1.5] - 2026-04-26

### Added

* Realtime system — server-side update pipeline plus web client manager and store handlers for live data sync
* Federated collection sharing — full sharing model with roles, resharing policies, public links, and federated identity support
* Google Docs–style Share Dialog — unified sharing UI with access list, avatars, real names, and public link controls
* Public link lifecycle — mint, revoke, and unauthenticated resolver endpoints
* Versioned collection keys — key rotation orchestrator and scheme-aware encryption support
* Dual-scheme integrations — support for multiple encryption schemes with client hydration and persistence
* Dawarich integration scaffold — E2EE-only integration plumbing and config schema
* Icon system expansion — Lucide alias search, Maki icons tab, and extended icon color options
* Virtualized icon picker — performant large icon grids via virtualization
* Settings search — fuzzy search for faster navigation
* Theme system expansion — extended palette, accent-aware neutrals, and additional theme options
* Toast improvements — ghost-style actions and contextual “View” actions
* Bookmark UX enhancements — collection picker, state badging, and improved interaction flows

### Changed

* Settings UI overhaul — colored icons, submenu structure, and improved navigation
* Share system refactor — replaced legacy dialogs with a unified Share Dialog
* Collections model — now uses last-saved pointer instead of default collection
* Bookmark behavior — second click now performs silent un-save and move
* Icon system wiring — consistent usage across bookmarks and collections
* Integration system refactor — scheme-aware CRUD, filtering, and hydration
* i18n expansion — identity, auth, and key management strings localized (en/es)
* Security UX — “Security” reframed as “Encryption keys” with clearer flows and warnings
* Passkey flow — consolidated to single biometric with automatic encrypted data restore
* Account and dialogs UI polish — tighter layouts, clearer states, improved copy across settings and recovery flows
* Alerts and theming — semantic variants, dark mode support, and refined color scales

### Fixed

* Bookmark write-gate vulnerability and related i18n key issue
* Remove-from-collection endpoint URL bug
* Collection picker ordering instability while open
* Cleanup of orphaned peer state after E2EE identity reset
* Integration controller error handling (distinguish known vs unexpected errors)
* Dependents endpoint scoping and userId leak
* Device-transfer race condition during sealed-seed upload
* Crypto boot checks and environment configuration reliability

### Removed

* Legacy ShareWithFriendDialog in favor of unified sharing flow
* Unused v1 location encryption helpers and stale TODO / placeholder code
* Location history tracking system

## [0.1.4] - 2026-04-18

### Added
* Barrelman tile server support — new integration renders self-hosted vector tiles with the OpenMapTiles schema, bundled with `osm-liberty` and `openmaptiles-default` styles and a basemap style config system
* Nested layer groups — hierarchical layer organization with clone-on-modify semantics, backed by server-side defaults (cycling, transit, mapillary, friends) and DB migrations `0024_layers_unified_model` through `0027`
* Fade basemap option — per-layer toggle that dims the underlying basemap when a layer is active, wired into `layer-visibility` service
* Refined cycling layer — expanded style rules covering bike lanes, trails, and route hierarchy, served through a new server-side tile proxy endpoint
* Unified routing adapters — `barrelman-graphhopper` and `barrelman-valhalla` adapters plus a shared `unified-routing.types` surface, letting trips use Barrelman, GraphHopper, or Valhalla interchangeably
* Custom GraphHopper profile for inner-city street speed limits, with a reusable `graphhopper-custom-model` builder
* Routing preferences UI overhaul — per-profile color system (`route-profile-colors`), richer elevation chart, and new layer-group helpers
* Draggable waypoint markers on the trip detail view, backed by `waypoints-layer` and `base-marker-layer` drag handlers
* Unified floating nav buttons across the drawer UI — new `SheetActionButtons` component used consistently by `BottomSheet`, `LeftSheet`, place, trip, friend, and collection views
* Smooth map padding transitions — map viewport animates in sync with drawer open/close via new `map-padding` utility

### Changed
* Layers system refactor — split monolithic `layer.constants.ts` into per-feature modules (`core-layers`, `cycling-layers`, `transit-layers`, `mapillary-layers`, `user-layer-templates`, etc.) and moved defaults server-side
* `LayerConfiguration` / `LayerGroupConfiguration` rebuilt around the new unified layer model and nested group semantics
* `RoutingPreferences` view rewritten to support multi-provider routing and the new profile color scheme
* `TripDetail` view restructured with improved waypoint handling and elevation chart integration
* Obstructing component logic in `useObstructingComponent` simplified and made reactive to drawer transitions
* UI spacing pass — tightened `BottomSheet`, `LeftSheet`, `MobileNavigation`, responsive dropdown/popover/dialog, and integrations page padding

### Fixed
* GraphHopper profile data issues — corrected custom-model serialization and downstream elevation/segment parsing in `TripDetail` and `directions.store`

## [0.1.2-1] - 2026-04-05

### Added
* OSM Notes layer — toggle in layers panel to view OpenStreetMap notes on the map, with grid-based tile caching (0.5° tiles, 24h TTL, 500 note cap)
* Note detail view — view note comments, status, and metadata with sticky header (back button, status badge, external link to OSM) and fixed footer actions
* Note commenting — add comments to open notes, resolve notes, or reopen resolved notes with per-action loading spinners
* Note creation — right-click context menu "Add note" places a draggable amber pulsing marker, submit via form panel
* OSM OAuth2 integration — connect your OpenStreetMap account to associate notes with your profile

### Changed
* Place detail view only removes its own marker instead of calling `removeAllMarkers`, preserving note layer markers
* Added `text-2xs` (0.625rem) font size to Tailwind theme

## [0.1.1] - 2026-04-02

### Added
* Search along route — find places along a polyline corridor via new `/search/route` endpoint and client-side `searchAlongRoute` service
* Building interior discovery — any building or office area now shows category chips (offices, shops, restaurants, cafes, toilets, drinking water, parking) for exploring what's inside
* Category-enriched search index — POI category labels (e.g. "apartments", "theme park") are now included in the tsvector, so queries like "winnifred apartments" find "The Winnifred"
* Airport code search — IATA/ICAO codes (e.g. "CLT", "AVL") now surface airports via a dedicated codes column and GIN index
* Acronym and abbreviation search — auto-generated abbreviations (e.g. "uncc" → University of North Carolina at Charlotte) stored in `name_abbrev` column with B-tree index
* Barrelman integration tests — 21 integration tests covering exact name match, airport codes, acronyms, global search, local bias, category search, category demotion, and performance

### Changed
* Search ranking overhaul — replaced hard radius filter with proximity-aware ORDER BY (`text_rank / (1 + distance / decay)`) so results are globally available but locally biased
* FTS similarity boost — exact name matches get a relevance boost via `similarity()` threshold, so "Carowinds" ranks above "Days Inn Near Carowinds"
* Category demotion — roads (`highway/*`) and surveillance cameras are demoted in search results to reduce noise
* Search results interleaving — server now returns categories, bookmarks, recent places, and external places interleaved by relevance score instead of grouped by type
* Client search simplified — removed client-side category search and re-sorting; trusts server-side relevance ordering
* Preserve integration ranking — removed pure-distance re-sort in `place.service.ts` that was destroying Barrelman's text-relevance ranking
* Children endpoint — category filter now supports prefix matching (e.g. "office" matches "office/lawyer", "office/accountant")
* Codes generation — rewrote `generate-codes.ts` to use a single SQL UPDATE (~70K rows in seconds vs hours-long batch iteration)
* Import pipeline — `run-import.sh` and `update-osm.sh` now include codes generation step and rebuild tsvector with category labels

### Fixed
* "Carowinds" search ranking — exact name match now ranks first instead of behind partial mentions like "Days Inn Near Carowinds"
* "AVL" / "AVL airport" not finding Asheville Regional Airport — fixed by adding dedicated codes column with IATA/ICAO tags and GIN index
* GIN index not used for code lookups — changed from `= ANY(codes)` to `codes @> ARRAY[query]` which GIN supports
* Search layer sequential scan — split OR condition into separate queries to allow both indexes to be used
* Post-fetch re-rank decay mismatch — aligned SQL and post-fetch decay to same 50km half-life
* `lat=0` falsy bug regression test — ensured lat=0 (equator) doesn't skip location-aware search

## [0.1.0] - 2026-03-31

### Added
###  Barrelman
Barrelman integration introduced to provide faster, more capable OSM search and lookup capabilities. This is a from-scratch server hosted at https://barrelman.parchment.app and self-hostable. Repo and documentation here:
https://github.com/alexwohlbruck/barrelman

### Other
* POI types and categories with icon and color mapping
* Maki icon support for place type display
* Place detail widgets system (OSM tags, related places, transit)
* Nearby categories component for discovering places
* Overpass integration for querying OpenStreetMap data
* Place type chip component
* Keyboard shortcut hints in minimized side navigation
* Startup location options in behavior settings
* Abort controller composable for managing async requests
* App data caching layer
* Map bounds utilities
* Barrelman and search service tests
* Category service tests

### Changed
* Redesigned place header with category icons and colors
* Improved place list items with richer type information
* Refactored search utilities and search results display
* Enhanced category store with palette-based color assignment
* Updated Nominatim adapter response handling

### Fixed
* Bottom sheet fit-content scroll interaction

[Releases before 0.1.0](https://github.com/alexwohlbruck/parchment/releases?q=v0.0) are listed on GitHub.
