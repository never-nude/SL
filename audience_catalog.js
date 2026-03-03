(function () {
  var catalog = window.SL_CATALOG || [];
  if (!Array.isArray(catalog) || !catalog.length) return;

  var TAG_RULES = [
    { title: "Harry Potter and the Philosopher's Stone", type: "Book", audience: ["kids", "ya"] },
    { title: "Harry Potter and the Sorcerer's Stone", type: "Book", audience: ["kids", "ya"] },
    { title: "Harry Potter and the Goblet of Fire", type: "Film", audience: ["kids", "ya"] },
    { title: "The Hunger Games", audience: ["ya"] },
    { title: "Catching Fire", audience: ["ya"] },
    { title: "Mockingjay", audience: ["ya"] },
    { title: "Divergent", audience: ["ya"] },
    { title: "The Maze Runner", audience: ["ya"] },
    { title: "The Fault in Our Stars", audience: ["ya"] },
    { title: "Percy Jackson and the Olympians", audience: ["kids", "ya"] },
    { title: "Stranger Things", type: "TV", audience: ["ya"] },
    { title: "Wednesday", type: "TV", audience: ["ya"] },
    { title: "Bluey", type: "TV", audience: ["kids"] },
    { title: "Toy Story", type: "Film", audience: ["kids"] },
    { title: "Frozen", type: "Film", audience: ["kids"] },
    { title: "Moana", type: "Film", audience: ["kids"] },
    { title: "Encanto", type: "Film", audience: ["kids"] },
    { title: "Zootopia", type: "Film", audience: ["kids"] },
    { title: "Finding Nemo", type: "Film", audience: ["kids"] },
    { title: "The Lion King", type: "Film", audience: ["kids"] }
  ];

  var ADDITIONS = [
    { id: "aud_kids_toy_story_1995", title: "Toy Story", type: "Film", year: 1995, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_toy_story_2_1999", title: "Toy Story 2", type: "Film", year: 1999, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_toy_story_3_2010", title: "Toy Story 3", type: "Film", year: 2010, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_toy_story_4_2019", title: "Toy Story 4", type: "Film", year: 2019, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_finding_nemo_2003", title: "Finding Nemo", type: "Film", year: 2003, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_finding_dory_2016", title: "Finding Dory", type: "Film", year: 2016, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_frozen_2013", title: "Frozen", type: "Film", year: 2013, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_frozen_2_2019", title: "Frozen II", type: "Film", year: 2019, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_moana_2016", title: "Moana", type: "Film", year: 2016, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_encanto_2021", title: "Encanto", type: "Film", year: 2021, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_zootopia_2016", title: "Zootopia", type: "Film", year: 2016, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_lion_king_1994", title: "The Lion King", type: "Film", year: 1994, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_beauty_and_the_beast_1991", title: "Beauty and the Beast", type: "Film", year: 1991, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_aladdin_1992", title: "Aladdin", type: "Film", year: 1992, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_the_little_mermaid_1989", title: "The Little Mermaid", type: "Film", year: 1989, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_tangled_2010", title: "Tangled", type: "Film", year: 2010, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_shrek_2001", title: "Shrek", type: "Film", year: 2001, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_shrek_2_2004", title: "Shrek 2", type: "Film", year: 2004, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_how_to_train_your_dragon_2010", title: "How to Train Your Dragon", type: "Film", year: 2010, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_kung_fu_panda_2008", title: "Kung Fu Panda", type: "Film", year: 2008, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_despicable_me_2010", title: "Despicable Me", type: "Film", year: 2010, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_minions_2015", title: "Minions", type: "Film", year: 2015, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_the_lego_movie_2014", title: "The Lego Movie", type: "Film", year: 2014, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_paddington_2014", title: "Paddington", type: "Film", year: 2014, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_paddington_2_2017", title: "Paddington 2", type: "Film", year: 2017, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_bluey_2018", title: "Bluey", type: "TV", year: 2018, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_spongebob_squarepants_1999", title: "SpongeBob SquarePants", type: "TV", year: 1999, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_avatar_last_airbender_2005", title: "Avatar: The Last Airbender", type: "TV", year: 2005, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_gravity_falls_2012", title: "Gravity Falls", type: "TV", year: 2012, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_adventure_time_2010", title: "Adventure Time", type: "TV", year: 2010, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_phineas_and_ferb_2007", title: "Phineas and Ferb", type: "TV", year: 2007, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_pokemon_1997", title: "Pokemon", type: "TV", year: 1997, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_steven_universe_2013", title: "Steven Universe", type: "TV", year: 2013, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_the_owl_house_2020", title: "The Owl House", type: "TV", year: 2020, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_hilda_2018", title: "Hilda", type: "TV", year: 2018, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_charlottes_web_1952", title: "Charlotte's Web", type: "Book", year: 1952, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_matilda_book_1988", title: "Matilda", type: "Book", year: 1988, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_the_bfg_1982", title: "The BFG", type: "Book", year: 1982, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_narnia_lion_witch_1950", title: "The Lion, the Witch and the Wardrobe", type: "Book", year: 1950, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_diary_of_a_wimpy_kid_2007", title: "Diary of a Wimpy Kid", type: "Book", year: 2007, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_wonder_2012", title: "Wonder", type: "Book", year: 2012, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_holes_1998", title: "Holes", type: "Book", year: 1998, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_phantom_tollbooth_1961", title: "The Phantom Tollbooth", type: "Book", year: 1961, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_tale_of_despereaux_2003", title: "The Tale of Despereaux", type: "Book", year: 2003, mainstream: true, audience: ["kids"] },
    { id: "aud_kids_bridge_to_terabithia_1977", title: "Bridge to Terabithia", type: "Book", year: 1977, mainstream: true, audience: ["kids"] },

    { id: "aud_ya_the_hunger_games_2012", title: "The Hunger Games", type: "Film", year: 2012, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_catching_fire_2013", title: "The Hunger Games: Catching Fire", type: "Film", year: 2013, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_mockingjay_part_1_2014", title: "The Hunger Games: Mockingjay - Part 1", type: "Film", year: 2014, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_mockingjay_part_2_2015", title: "The Hunger Games: Mockingjay - Part 2", type: "Film", year: 2015, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_twilight_2008", title: "Twilight", type: "Film", year: 2008, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_fault_in_our_stars_2014", title: "The Fault in Our Stars", type: "Film", year: 2014, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_divergent_2014", title: "Divergent", type: "Film", year: 2014, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_maze_runner_2014", title: "The Maze Runner", type: "Film", year: 2014, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_to_all_the_boys_2018", title: "To All the Boys I've Loved Before", type: "Film", year: 2018, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_love_simon_2018", title: "Love, Simon", type: "Film", year: 2018, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_perks_wallflower_2012", title: "The Perks of Being a Wallflower", type: "Film", year: 2012, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_easy_a_2010", title: "Easy A", type: "Film", year: 2010, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_ten_things_i_hate_about_you_1999", title: "10 Things I Hate About You", type: "Film", year: 1999, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_the_princess_diaries_2001", title: "The Princess Diaries", type: "Film", year: 2001, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_booksmart_2019", title: "Booksmart", type: "Film", year: 2019, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_spider_man_homecoming_2017", title: "Spider-Man: Homecoming", type: "Film", year: 2017, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_wednesday_2022", title: "Wednesday", type: "TV", year: 2022, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_never_have_i_ever_2020", title: "Never Have I Ever", type: "TV", year: 2020, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_heartstopper_2022", title: "Heartstopper", type: "TV", year: 2022, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_sex_education_2019", title: "Sex Education", type: "TV", year: 2019, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_outer_banks_2020", title: "Outer Banks", type: "TV", year: 2020, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_riverdale_2017", title: "Riverdale", type: "TV", year: 2017, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_teen_wolf_2011", title: "Teen Wolf", type: "TV", year: 2011, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_the_vampire_diaries_2009", title: "The Vampire Diaries", type: "TV", year: 2009, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_pretty_little_liars_2010", title: "Pretty Little Liars", type: "TV", year: 2010, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_glee_2009", title: "Glee", type: "TV", year: 2009, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_one_tree_hill_2003", title: "One Tree Hill", type: "TV", year: 2003, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_gossip_girl_2007", title: "Gossip Girl", type: "TV", year: 2007, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_hunger_games_book_2008", title: "The Hunger Games", type: "Book", year: 2008, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_catching_fire_book_2009", title: "Catching Fire", type: "Book", year: 2009, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_mockingjay_book_2010", title: "Mockingjay", type: "Book", year: 2010, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_divergent_book_2011", title: "Divergent", type: "Book", year: 2011, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_maze_runner_book_2009", title: "The Maze Runner", type: "Book", year: 2009, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_fault_in_our_stars_book_2012", title: "The Fault in Our Stars", type: "Book", year: 2012, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_looking_for_alaska_2005", title: "Looking for Alaska", type: "Book", year: 2005, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_paper_towns_2008", title: "Paper Towns", type: "Book", year: 2008, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_perks_wallflower_book_1999", title: "The Perks of Being a Wallflower", type: "Book", year: 1999, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_the_book_thief_2005", title: "The Book Thief", type: "Book", year: 2005, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_eleanor_and_park_2012", title: "Eleanor & Park", type: "Book", year: 2012, mainstream: true, audience: ["ya"] },
    { id: "aud_ya_absolutely_true_diary_2007", title: "The Absolutely True Diary of a Part-Time Indian", type: "Book", year: 2007, mainstream: true, audience: ["ya"] }
  ];

  function normalizeType(type) {
    if (type === "Film" || type === "TV" || type === "Book") return type;
    return "";
  }

  function normalizeTitle(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, "\"")
      .replace(/[–—]/g, "-")
      .replace(/\s+\((film|book|tv)\)$/i, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAudience(raw) {
    if (!raw) return [];
    var list = Array.isArray(raw) ? raw : [raw];
    var seen = {};
    var out = [];

    for (var i = 0; i < list.length; i++) {
      var tag = String(list[i] || "").toLowerCase().trim();
      if (!tag) continue;
      if (tag === "teen") tag = "ya";
      if (tag === "family") tag = "kids";
      if (tag !== "ya" && tag !== "kids" && tag !== "all") continue;
      if (seen[tag]) continue;
      seen[tag] = true;
      out.push(tag);
    }

    return out;
  }

  function addAudience(item, tags) {
    if (!item) return;
    var next = normalizeAudience(tags);
    if (!next.length) return;

    var base = normalizeAudience(item.audience);
    var seen = {};
    var merged = [];
    var i = 0;

    for (i = 0; i < base.length; i++) {
      seen[base[i]] = true;
      merged.push(base[i]);
    }

    for (i = 0; i < next.length; i++) {
      if (seen[next[i]]) continue;
      seen[next[i]] = true;
      merged.push(next[i]);
    }

    item.audience = merged;
  }

  function signature(item) {
    return [
      normalizeTitle(item.title),
      normalizeType(item.type),
      Number(item.year) || 0
    ].join("|");
  }

  function matchesRule(item, rule) {
    if (!item || !rule) return false;
    if (rule.type && normalizeType(item.type) !== normalizeType(rule.type)) return false;
    if (rule.year && Number(item.year) !== Number(rule.year)) return false;
    return normalizeTitle(item.title) === normalizeTitle(rule.title);
  }

  var byId = {};
  var bySignature = {};
  var i = 0;

  for (i = 0; i < catalog.length; i++) {
    var item = catalog[i];
    if (!item || !item.id) continue;

    byId[item.id] = item;
    bySignature[signature(item)] = item;
  }

  for (i = 0; i < TAG_RULES.length; i++) {
    var rule = TAG_RULES[i];
    for (var j = 0; j < catalog.length; j++) {
      if (matchesRule(catalog[j], rule)) addAudience(catalog[j], rule.audience);
    }
  }

  for (i = 0; i < ADDITIONS.length; i++) {
    var add = ADDITIONS[i];
    if (!add || !add.id) continue;

    var sig = signature(add);
    var existing = byId[add.id] || bySignature[sig];
    if (existing) {
      addAudience(existing, add.audience);
      if (add.mainstream === true) existing.mainstream = true;
      continue;
    }

    var copy = {
      id: add.id,
      title: add.title,
      type: normalizeType(add.type) || "Film",
      year: Number(add.year) || 2000,
      mainstream: add.mainstream === true,
      audience: normalizeAudience(add.audience)
    };

    catalog.push(copy);
    byId[copy.id] = copy;
    bySignature[signature(copy)] = copy;
  }

  window.SL_CATALOG = catalog;
})();
