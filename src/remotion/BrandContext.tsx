import {createContext, useContext} from "react";
import type {RenderManifest} from "./schema";

const BrandContext = createContext<RenderManifest["brand"] | null>(null);
export const BrandProvider = BrandContext.Provider;
export const useBrand = () => useContext(BrandContext);
