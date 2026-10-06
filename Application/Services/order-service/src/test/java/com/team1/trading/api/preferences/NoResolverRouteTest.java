package com.team1.trading.api.preferences;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class NoResolverRouteTest {

    @Test
    @DisplayName("No route anywhere in the API resolves a contact detail or delivers a message")
    void noResolveOrDeliverRoute() throws Exception {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));

        List<String> paths = new ArrayList<>();
        for (BeanDefinition definition : scanner.findCandidateComponents("com.team1.trading.api")) {
            Class<?> type = Class.forName(definition.getBeanClassName());
            RequestMapping onClass = AnnotatedElementUtils.findMergedAnnotation(type, RequestMapping.class);
            String base = onClass == null || onClass.value().length == 0 ? "" : onClass.value()[0];
            for (Method method : type.getDeclaredMethods()) {
                RequestMapping onMethod = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping.class);
                if (onMethod != null) {
                    String sub = onMethod.value().length == 0 ? "" : onMethod.value()[0];
                    paths.add(base + sub);
                }
            }
        }

        assertThat(paths).isNotEmpty();
        assertThat(paths).noneMatch(p -> p.toLowerCase().contains("resolve"));
        assertThat(paths).noneMatch(p -> p.toLowerCase().contains("deliver"));
        assertThat(paths).noneMatch(p -> p.toLowerCase().contains("/internal"));
    }

    @Test
    @DisplayName("Preferences publishes the resolver as a Java interface")
    void resolverIsAnInterface() {
        assertThat(PreferenceResolver.class).isInterface();
    }
}
