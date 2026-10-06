package com.team1.trading.api.notifications;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ConsumerGroupUniquenessTest {

    @Test
    @DisplayName("Each reserved consumer group id is used by exactly one listener, so partitions are never split")
    void groupIdsAreNotShared() throws Exception {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(Component.class));

        List<String> groups = new ArrayList<>();
        for (BeanDefinition definition : scanner.findCandidateComponents("com.team1.trading.api")) {
            Class<?> type = Class.forName(definition.getBeanClassName());
            for (Method method : type.getDeclaredMethods()) {
                KafkaListener listener = AnnotatedElementUtils.findMergedAnnotation(method, KafkaListener.class);
                if (listener != null) {
                    groups.add(listener.groupId());
                }
            }
        }

        assertThat(groups).contains("notification-service", "portfolio-service", "watchlist-service");
        assertThat(groups).doesNotHaveDuplicates();
    }
}
