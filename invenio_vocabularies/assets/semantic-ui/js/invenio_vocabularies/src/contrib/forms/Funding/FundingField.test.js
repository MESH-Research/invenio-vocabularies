// This file is part of InvenioVocabularies
// Copyright (C) 2026 CERN.
//
// Invenio is free software; you can redistribute it and/or modify it
// under the terms of the MIT License; see LICENSE file for more details.

import { Formik } from "formik";
import React from "react";
import { act } from "react-dom/test-utils";
import { fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/extend-expect";

import { FundingField } from "./FundingField";

// CustomAwardForm's RemoteSelectField hits /api/funders. Stub it so tests can
// set a funder without network access, while keeping TextField for title edits.
jest.mock("react-invenio-forms", () => {
  const actual = jest.requireActual("react-invenio-forms");
  const React = require("react");
  const { useFormikContext } = require("formik");

  return {
    ...actual,
    RemoteSelectField: () => {
      const { setFieldValue } = useFormikContext();
      return (
        <button
          type="button"
          onClick={() =>
            setFieldValue("selectedFunding.funder", {
              id: "01abc",
              name: "Test Funder",
            })
          }
        >
          Set test funder
        </button>
      );
    },
  };
});

// jsdom may lack crypto.randomUUID (used for stable item keys) and matchMedia
// (used by Semantic UI). Stub both here and restore in afterAll so nothing
// leaks into other suites.
let createdCryptoStub = false;
let originalRandomUUID;
let originalMatchMedia;

beforeAll(() => {
  if (!window.crypto) {
    Object.defineProperty(window, "crypto", { value: {}, configurable: true });
    createdCryptoStub = true;
  }
  originalRandomUUID = window.crypto.randomUUID;
  if (typeof originalRandomUUID !== "function") {
    let uuidCounter = 0;
    window.crypto.randomUUID = () => `test-uuid-${(uuidCounter += 1)}`;
  }

  originalMatchMedia = window.matchMedia;
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

afterAll(() => {
  if (createdCryptoStub) {
    delete window.crypto;
  } else if (originalRandomUUID) {
    window.crypto.randomUUID = originalRandomUUID;
  } else {
    delete window.crypto.randomUUID;
  }

  if (originalMatchMedia) {
    window.matchMedia = originalMatchMedia;
  } else {
    delete window.matchMedia;
  }
});

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const searchConfig = {
  searchApi: {
    axios: {
      headers: { Accept: "application/vnd.inveniordm.v1+json" },
      url: "/api/awards",
      withCredentials: false,
    },
  },
  initialQueryState: {
    sortBy: "bestmatch",
    sortOrder: "asc",
    queryString: "",
    filters: [],
  },
};

const renderFundingField = (funding = []) => {
  return render(
    <Formik initialValues={{ metadata: { funding } }} onSubmit={() => {}}>
      {() => (
        <FundingField fieldPath="metadata.funding" searchConfig={searchConfig} />
      )}
    </Formik>
  );
};

// FundingModal.closeModal defers the focus restore with setTimeout(0),
// so run the pending timers inside act to flush the state updates.
const flushFocusRestore = async () => {
  await act(async () => {
    jest.runAllTimers();
  });
};

describe("FundingField modal focus management", () => {
  it("returns focus to the trigger when the modal is cancelled", async () => {
    const { getByText, queryByPlaceholderText } = renderFundingField();
    const addCustomButton = getByText("Add custom");

    fireEvent.click(addCustomButton);
    fireEvent.click(getByText("Cancel"));
    await flushFocusRestore();

    expect(queryByPlaceholderText("Award/Grant Title")).not.toBeInTheDocument();
    expect(addCustomButton).toHaveFocus();
  });

  it("returns focus to the trigger when the modal is closed with Escape", async () => {
    const { getByText, queryByPlaceholderText } = renderFundingField();
    const addCustomButton = getByText("Add custom");

    fireEvent.click(addCustomButton);
    fireEvent.keyDown(document, { key: "Escape", keyCode: 27, which: 27 });
    await flushFocusRestore();

    expect(queryByPlaceholderText("Award/Grant Title")).not.toBeInTheDocument();
    expect(addCustomButton).toHaveFocus();
  });

  it("returns focus to the trigger after adding custom funding", async () => {
    const { getByText, getByPlaceholderText, queryByPlaceholderText } =
      renderFundingField();
    const addCustomButton = getByText("Add custom");

    fireEvent.click(addCustomButton);
    fireEvent.click(getByText("Set test funder"));
    fireEvent.change(getByPlaceholderText("Award/Grant Title"), {
      target: { value: "My Custom Award" },
    });
    await act(async () => {
      // Modal action button; avoid matching the field's "Add" / "Add custom" triggers.
      fireEvent.click(getByText("Add", { selector: ".actions .button" }));
    });
    await flushFocusRestore();

    expect(queryByPlaceholderText("Award/Grant Title")).not.toBeInTheDocument();
    expect(getByText("My Custom Award")).toBeInTheDocument();
    expect(addCustomButton).toHaveFocus();
  });

  it("returns focus to the row's edit button after editing funding", async () => {
    const { getByText, getByPlaceholderText, queryByPlaceholderText } =
      renderFundingField([
        {
          funder: { id: "01abc", name: "Test Funder" },
          award: { title: "Original Award", number: "", url: "" },
        },
      ]);
    const editButton = getByText("Edit");

    fireEvent.click(editButton);
    fireEvent.change(getByPlaceholderText("Award/Grant Title"), {
      target: { value: "Renamed Award" },
    });
    await act(async () => {
      fireEvent.click(getByText("Change"));
    });
    await flushFocusRestore();

    expect(queryByPlaceholderText("Award/Grant Title")).not.toBeInTheDocument();
    expect(getByText("Renamed Award")).toBeInTheDocument();
    expect(getByText("Edit")).toHaveFocus();
  });
});

// We ensure that key handling hasn't broken the drag and drop reordering.
describe("FundingField drag and drop reordering", () => {
  // jsdom doesn't implement DragEvent or DataTransfer, so we pass a stub
  // dataTransfer for react-dnd's HTML5 backend to simulate the real drag
  // event's object that carries payload data, settings, etc.
  const makeDataTransfer = () => ({
    setData: () => {},
    getData: () => "",
    setDragImage: () => {},
    dropEffect: "",
    effectAllowed: "all",
    types: [],
  });

  it("reorders funding rows when one row is dragged over another", () => {
    const { container } = renderFundingField([
      {
        funder: { id: "01a", name: "Funder A" },
        award: { title: "First Award", number: "", url: "" },
      },
      {
        funder: { id: "01b", name: "Funder B" },
        award: { title: "Second Award", number: "", url: "" },
      },
    ]);

    const titlesInOrder = () =>
      Array.from(
        container.querySelectorAll(".deposit-drag-listitem .header")
      ).map((node) => node.textContent.trim());
    expect(titlesInOrder()).toEqual(["First Award", "Second Award"]);

    const dragHandles = container.querySelectorAll(".drag-anchor");
    const rows = container.querySelectorAll(".deposit-drag-listitem");
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(dragHandles[0], { dataTransfer });
    // The HTML5 backend publishes the drag source in a setTimeout(0);
    // flush it before hovering or the hover handler sees no drag item.
    act(() => {
      jest.runAllTimers();
    });
    fireEvent.dragEnter(rows[1], { dataTransfer });
    fireEvent.dragOver(rows[1], { dataTransfer });
    fireEvent.drop(rows[0], { dataTransfer });
    fireEvent.dragEnd(dragHandles[0], { dataTransfer });

    expect(titlesInOrder()).toEqual(["Second Award", "First Award"]);
  });
});
