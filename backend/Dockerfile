FROM gradle:8.7-jdk17-alpine AS build

WORKDIR /app
COPY build.gradle settings.gradle ./
COPY gradle gradle
RUN gradle dependencies --no-daemon 2>/dev/null || true

COPY src src
RUN gradle bootJar --no-daemon -x test

FROM eclipse-temurin:17-jre-alpine

WORKDIR /app
COPY --from=build /app/build/libs/nemesis-server-1.0.0.jar app.jar

EXPOSE 18080 17001

ENTRYPOINT ["java", "-jar", "app.jar"]
