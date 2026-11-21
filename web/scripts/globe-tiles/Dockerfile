FROM debian:bookworm-slim AS tippecanoe
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libsqlite3-dev zlib1g-dev git ca-certificates \
 && git clone --depth 1 --branch 2.79.0 https://github.com/felt/tippecanoe.git /src && make -C /src -j8 && make -C /src install

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libsqlite3-0 zlib1g curl unzip && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir shapely==2.1.2 pyogrio==0.11.1 numpy==2.3.4 pillow==12.0.0 scipy==1.16.3 scikit-image==0.25.2
COPY --from=tippecanoe /usr/local/bin/tippecanoe /usr/local/bin/tile-join /usr/local/bin/
