// FAKE crew for tests only (moved from the Crew Board). Never real people.
module.exports = {
  "_meta": "FAKE DATA for development only. Never commit real crew data to the repo.",
  "workers": [
    {
      "id": "C01",
      "name": "Alex Test",
      "phone": "555-0101",
      "photo": null,
      "is_lead": true,
      "can_operate": [
        "blower",
        "sweepster",
        "bobcat",
        "shovel"
      ],
      "can_drive": true,
      "rides_with": null,
      "clearances": [],
      "valid_id": true,
      "cold_rated": true,
      "gear": "own",
      "smokes": false,
      "logs_own_work": true,
      "works_well_with": [
        "C04"
      ],
      "keep_apart_from": [],
      "good_lead": true,
      "on_call": true,
      "reliable_3am": true,
      "seasons": 4,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C02",
      "name": "Sam Sample",
      "phone": "555-0102",
      "photo": null,
      "is_lead": true,
      "can_operate": [
        "blower",
        "snowrator",
        "shovel"
      ],
      "can_drive": true,
      "rides_with": null,
      "clearances": [
        {
          "site": "JBER",
          "cleared": true,
          "date": "2025-11-01",
          "expires": "2026-10-20"
        }
      ],
      "valid_id": true,
      "cold_rated": true,
      "gear": "own",
      "smokes": true,
      "logs_own_work": true,
      "works_well_with": [],
      "keep_apart_from": [
        "C06"
      ],
      "good_lead": true,
      "on_call": true,
      "reliable_3am": true,
      "seasons": 3,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C03",
      "name": "Jordan Demo",
      "phone": "555-0103",
      "photo": null,
      "is_lead": false,
      "can_operate": [
        "shovel"
      ],
      "can_drive": false,
      "rides_with": "C01",
      "clearances": [],
      "valid_id": true,
      "cold_rated": false,
      "gear": "needs_issued",
      "smokes": false,
      "logs_own_work": false,
      "works_well_with": [],
      "keep_apart_from": [],
      "good_lead": false,
      "on_call": true,
      "reliable_3am": false,
      "seasons": 0,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C04",
      "name": "Casey Mock",
      "phone": "555-0104",
      "photo": null,
      "is_lead": false,
      "can_operate": [
        "blower",
        "shovel"
      ],
      "can_drive": false,
      "rides_with": null,
      "clearances": [],
      "valid_id": false,
      "cold_rated": true,
      "gear": "own",
      "smokes": false,
      "logs_own_work": false,
      "works_well_with": [
        "C01"
      ],
      "keep_apart_from": [],
      "good_lead": false,
      "on_call": true,
      "reliable_3am": true,
      "seasons": 2,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C05",
      "name": "Riley Fake",
      "phone": "555-0105",
      "photo": null,
      "is_lead": false,
      "can_operate": [
        "sweepster",
        "shovel"
      ],
      "can_drive": true,
      "rides_with": null,
      "clearances": [],
      "valid_id": true,
      "cold_rated": true,
      "gear": "own",
      "smokes": true,
      "logs_own_work": true,
      "works_well_with": [],
      "keep_apart_from": [],
      "good_lead": false,
      "on_call": false,
      "reliable_3am": true,
      "seasons": 1,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C06",
      "name": "Morgan Placeholder",
      "phone": "555-0106",
      "photo": null,
      "is_lead": false,
      "can_operate": [
        "shovel"
      ],
      "can_drive": false,
      "rides_with": null,
      "clearances": [],
      "valid_id": true,
      "cold_rated": false,
      "gear": "needs_issued",
      "smokes": true,
      "logs_own_work": false,
      "works_well_with": [],
      "keep_apart_from": [
        "C02"
      ],
      "good_lead": false,
      "on_call": true,
      "reliable_3am": false,
      "seasons": 0,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C07",
      "name": "Taylor Stub",
      "phone": "555-0107",
      "photo": null,
      "is_lead": true,
      "can_operate": [
        "blower",
        "bobcat",
        "snowrator",
        "shovel"
      ],
      "can_drive": true,
      "rides_with": null,
      "clearances": [],
      "valid_id": true,
      "cold_rated": true,
      "gear": "own",
      "smokes": false,
      "logs_own_work": true,
      "works_well_with": [],
      "keep_apart_from": [],
      "good_lead": true,
      "on_call": true,
      "reliable_3am": true,
      "seasons": 5,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C08",
      "name": "Drew Example",
      "phone": "555-0108",
      "photo": null,
      "is_lead": false,
      "can_operate": [
        "shovel",
        "blower"
      ],
      "can_drive": false,
      "rides_with": "C07",
      "clearances": [],
      "valid_id": true,
      "cold_rated": true,
      "gear": "own",
      "smokes": false,
      "logs_own_work": false,
      "works_well_with": [],
      "keep_apart_from": [],
      "good_lead": false,
      "on_call": true,
      "reliable_3am": true,
      "seasons": 1,
      "traits": "",
      "weaknesses": "",
      "archived": false
    },
    {
      "id": "C12",
      "name": "Pat Archived",
      "phone": "555-0112",
      "photo": null,
      "is_lead": false,
      "can_operate": [
        "shovel"
      ],
      "can_drive": true,
      "rides_with": null,
      "clearances": [],
      "valid_id": true,
      "cold_rated": true,
      "gear": "own",
      "smokes": false,
      "logs_own_work": false,
      "works_well_with": [],
      "keep_apart_from": [],
      "good_lead": false,
      "on_call": true,
      "reliable_3am": true,
      "seasons": 2,
      "traits": "",
      "weaknesses": "",
      "archived": true
    },
    {
      "id": "C10",
      "name": "Quinn Gap",
      "phone": "555-0110",
      "photo": null,
      "is_lead": false,
      "can_operate": [
        "shovel"
      ],
      "can_drive": false,
      "rides_with": "C12",
      "clearances": [],
      "valid_id": true,
      "cold_rated": true,
      "gear": "own",
      "smokes": false,
      "logs_own_work": false,
      "works_well_with": [],
      "keep_apart_from": [],
      "good_lead": false,
      "on_call": true,
      "reliable_3am": true,
      "seasons": 1,
      "traits": "",
      "weaknesses": "",
      "archived": false
    }
  ],
  "routes": [
    {
      "id": "N1",
      "name": "N1",
      "sites": [
        {
          "name": "PAC",
          "needs_clearance": null
        }
      ]
    },
    {
      "id": "N2",
      "name": "N2",
      "sites": [
        {
          "name": "JBER",
          "needs_clearance": "JBER"
        }
      ]
    },
    {
      "id": "N4",
      "name": "N4",
      "sites": [
        {
          "name": "TUDOR-TRANSIT",
          "needs_clearance": null
        }
      ]
    }
  ],
  "gear_log": [
    {
      "id": "g1",
      "date": "2026-01-14",
      "worker": "C06",
      "route": "N4",
      "site": "TUDOR-TRANSIT",
      "type": "left_on_site",
      "item": "Shovel (steel)",
      "note": "Recovered next shift"
    },
    {
      "id": "g2",
      "date": "2026-02-02",
      "worker": "C04",
      "route": "N1",
      "site": "PAC",
      "type": "broken",
      "item": "Blower #3 shear pin",
      "note": ""
    }
  ]
};
