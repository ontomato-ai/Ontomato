import { SDK_COMPONENT } from "../platform-object-types";
import type { PlatformTypeDetailDeclaration } from "../platform-type-details";

/*
 * The class page of a component of the SDK, as the SDK that ships it declares it: its public record is its entry in the
 * release's component catalogue (`appsSdkComponentCatalogEntrySchema`), and nothing of it is kept anywhere else.
 */
export const sdkComponentTypeDetail = {
  id: SDK_COMPONENT,
  definition:
    "A reusable interface component that one SDK release ships for a projection to draw its data with: it says what it means, what it may bind, which data it reads and which ports it exposes, and holds no business data of its own.",
  properties: [
    { name: "componentId", type: "string", description: "The component's identity within its release, which a projection's componentId names with the SDK's package." },
    { name: "module", type: "string", description: "The SDK module a page imports the component from, such as @ontomato/sdk/base." },
    { name: "exportName", type: "string", description: "The name the module exports the component under." },
    { name: "role", type: "\"presentation\" | \"control\"", description: "Whether the component draws something or is something the reader operates." },
    { name: "meaning", type: "string", description: "What the component draws or does, and what it does not, in one sentence." },
    { name: "effects", type: "string", optional: true, description: "Its side effects, such as a save or a run, when it has any." },
    { name: "bindsElement", type: "string[]", optional: true, description: "The ontology elements it may bind, as Kind:id, or Kind:* for any of a kind." },
    { name: "data", type: "AppsSdkComponentData", optional: true, description: "The data it reads, by the name a projection gives each: the read results each may hold, whether it is required and the run-time values the component gives itself; \"*\" takes any name." },
    { name: "config", type: "ComponentProp[]", optional: true, description: "The configuration a projection sets on it: each property's name, type, description, whether it is required and its default." },
    { name: "inputs", type: "Record<string, DirectProjectionInputType>", optional: true, description: "The typed values a placement supplies it, by name." },
    { name: "outputs", type: "Record<string, DirectPanelPortType>", optional: true, description: "The values a placement can bind to the panel's state, by name and type; an object of the projection's own type is @binding, which registration resolves. Signals without state are its events." },
    { name: "ports", type: "ComponentPorts", description: "Its props, events and slots, as the release's type information gives them." },
  ],
  rules:
    "A component exists only by shipping in an SDK release, whose catalogue lists it; nobody registers or changes one at run time. Anyone who may author a projection may use the components of the deployment's current SDK that declare projection data, and what is read or run through them is judged by the owners of that data and those operations, not by the component.",
} as const satisfies PlatformTypeDetailDeclaration;
