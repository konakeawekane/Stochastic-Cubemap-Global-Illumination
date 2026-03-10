export class TimingProfiler {
    constructor(renderer) {
        this.renderer = renderer;
        this.gl = renderer.getContext();
        this.isWebGL2 = typeof WebGL2RenderingContext !== "undefined" && this.gl instanceof WebGL2RenderingContext;
        this.ext = this.isWebGL2
            ? this.gl.getExtension("EXT_disjoint_timer_query_webgl2")
            : this.gl.getExtension("EXT_disjoint_timer_query");
        this.pending = [];
        this.results = {};
        this.active = null;
        this.frameStart = 0;
        this.totalCpu = 0;
    }

    beginFrame() {
        this.resolve();
        this.frameStart = performance.now();
        this.totalCpu = 0;
    }

    endFrame() {
        const frameMs = performance.now() - this.frameStart;
        this.results.Total = frameMs;
    }

    begin(name) {
        if (this.active) this.end(this.active.name);

        const entry = {
            name,
            cpuStart: performance.now(),
            query: null,
        };

        if (this.ext) {
            if (this.isWebGL2) {
                entry.query = this.gl.createQuery();
                this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, entry.query);
            } else if (this.ext.createQueryEXT) {
                entry.query = this.ext.createQueryEXT();
                this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, entry.query);
            }
        }

        this.active = entry;
    }

    end(name = null) {
        if (!this.active) return;
        const entry = this.active;
        if (name && entry.name !== name) return;

        const cpuMs = performance.now() - entry.cpuStart;
        this.totalCpu += cpuMs;

        if (entry.query && this.ext) {
            if (this.isWebGL2) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
            else this.ext.endQueryEXT(this.ext.TIME_ELAPSED_EXT);
            entry.cpuMs = cpuMs;
            this.pending.push(entry);
        } else {
            this.results[entry.name] = cpuMs;
        }

        this.active = null;
    }

    resolve() {
        if (!this.ext || this.pending.length === 0) return;

        const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT);
        const nextPending = [];

        for (const entry of this.pending) {
            const available = this.isWebGL2
                ? this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT_AVAILABLE)
                : this.ext.getQueryObjectEXT(entry.query, this.ext.QUERY_RESULT_AVAILABLE_EXT);

            if (!available) {
                nextPending.push(entry);
                continue;
            }

            if (disjoint) {
                this.results[entry.name] = entry.cpuMs;
                continue;
            }

            const elapsedNs = this.isWebGL2
                ? this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT)
                : this.ext.getQueryObjectEXT(entry.query, this.ext.QUERY_RESULT_EXT);
            this.results[entry.name] = elapsedNs / 1000000;
        }

        this.pending = nextPending;
    }

    getResults() {
        return { ...this.results };
    }
}
