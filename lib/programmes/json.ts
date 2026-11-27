import data from "@/data/programmes.json";
import type { Programme, ProgrammeSource } from "./source";

export class JsonProgrammeSource implements ProgrammeSource {
  async list(): Promise<Programme[]> {
    return data as Programme[];
  }
}
